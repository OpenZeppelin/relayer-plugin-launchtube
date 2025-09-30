/**
 * authCheck.ts
 *
 * Validates Soroban authorization entries and determines simulation requirements.
 * Checks for auth violations and handles source account authentication scenarios.
 */

import { xdr, Address } from '@stellar/stellar-sdk';
import { pluginError } from '@openzeppelin/relayer-sdk';
import { LaunchtubeRequest, ExtractedData, AuthCheckResult, SequenceAccount } from './types';
import { HTTP_STATUS } from './constants';

export function checkAuthAndSimDecision(
  request: LaunchtubeRequest,
  extracted: ExtractedData,
  sequence: SequenceAccount,
): AuthCheckResult {
  const violations: string[] = [];
  let forceNoSimulation = false;

  // Check each auth entry for violations
  for (const authEntry of extracted.auth || []) {
    switch (authEntry.credentials().switch()) {
      case xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount(): {
        // Source account auth requires the transaction source to sign
        // If we're simulating, we'll rebuild the tx with our sequence account
        // So we must disable simulation to preserve the original signatures
        if (request.sim) {
          forceNoSimulation = true;
          // Auto-disable simulation when source account auth is detected
          // This matches the original launchtube behavior
          console.log('Detected sorobanCredentialsSourceAccount with sim=true - auto-disabling simulation');
        }

        // Also check that the source account isn't our sequence account
        const txSource = extracted.inputTx?.source;
        const opSource = (extracted.inputTx?.operations[0] as any)?.source;

        if (txSource === sequence.address || opSource === sequence.address) {
          throw pluginError('`sorobanCredentialsSourceAccount` is invalid', {
            code: 'INVALID_CREDENTIALS',
            status: HTTP_STATUS.BAD_REQUEST,
            details: { reason: 'cannot use sequence account as source' },
          });
        }
        break;
      }

      case xdr.SorobanCredentialsType.sorobanCredentialsAddress(): {
        // Check that auth isn't trying to use our sequence account
        if (authEntry.credentials().address().address().switch() === xdr.ScAddressType.scAddressTypeAccount()) {
          const pk = authEntry.credentials().address().address().accountId();

          if (
            pk.switch() === xdr.PublicKeyType.publicKeyTypeEd25519() &&
            Address.account(pk.ed25519()).toString() === sequence.address
          ) {
            throw pluginError('`sorobanCredentialsAddress` is invalid', {
              code: 'INVALID_CREDENTIALS',
              status: HTTP_STATUS.BAD_REQUEST,
              details: { reason: 'cannot use sequence account in auth' },
            });
          }
        }
        break;
      }

      default:
        throw pluginError('Invalid credentials', { code: 'INVALID_CREDENTIALS', status: HTTP_STATUS.BAD_REQUEST });
    }
  }

  // No violations check needed - we throw immediately on errors now

  // Determine if we should simulate
  let shouldSimulate = request.sim && !forceNoSimulation;

  // For func-auth requests, we MUST simulate (no transaction to use)
  // Unless forceNoSimulation was set due to source account auth
  if (request.type === 'func-auth' && !forceNoSimulation) {
    shouldSimulate = true;
  }

  return {
    shouldSimulate,
    violations,
  };
}
