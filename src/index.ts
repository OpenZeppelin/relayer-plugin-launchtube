/**
 * index.ts
 *
 * Main entry point for the Launchtube plugin.
 * Orchestrates the transaction processing pipeline for Stellar/Soroban operations.
 */

import { StellarTransactionResponse, PluginContext, pluginError } from '@openzeppelin/relayer-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { PoolLock, SequencePool } from './pool';
import { loadConfig, getNetworkPassphrase } from './config';
import { LaunchtubeResponse, RpcClient, SequenceAccount } from './types';
import { validateAndParseRequest } from './validation';
import { extractFunctionAndAuth } from './extraction';
import { checkAuthAndSimDecision } from './authCheck';
import { simulateAndBuild, validateExistingTransaction } from './simulation';
import { calculateFee } from './fee';
import { isManagementRequest, handleManagement } from './management';

async function launchtube(context: PluginContext): Promise<LaunchtubeResponse> {
  const { api, kv, params } = context;

  // Management branch: handle and return immediately
  if (isManagementRequest(params)) {
    return await handleManagement(context);
  }

  // Load config and initialize per-request dependencies
  const config = loadConfig();
  const pool = new SequencePool(config.network, kv);
  const rpc: RpcClient = new SorobanRpc.Server(config.rpcUrl);

  let sequenceAccount: SequenceAccount | undefined;
  let poolLock: PoolLock | undefined;

  try {
    // 1. Validate and parse input into structured request
    const request = validateAndParseRequest(params);

    // 2. Get sequence account from pool
    poolLock = await pool.acquire();
    const sequenceRelayer = api.useRelayer(poolLock.relayerId);
    const sequenceInfo = await sequenceRelayer.getRelayer();

    if (!sequenceInfo) {
      throw pluginError('Relayer not found', {
        code: 'RELAYER_UNAVAILABLE',
        status: 502,
        details: { relayerId: poolLock.relayerId },
      });
    }
    const sequenceStatus = await sequenceRelayer.getRelayerStatus();
    if (sequenceStatus.network_type !== 'stellar') {
      throw pluginError('Sequence network type is not supported', {
        code: 'UNSUPPORTED_NETWORK',
        status: 400,
        details: { network_type: sequenceStatus.network_type },
      });
    }

    // Create complete sequence account with all required info
    sequenceAccount = {
      relayerId: poolLock.relayerId,
      address: sequenceInfo.address!,
      sequence: sequenceStatus.sequence_number,
    };

    // 3. Extract function and auth from either XDR or func+auth
    const networkPassphrase = getNetworkPassphrase(config.network);
    const extracted = extractFunctionAndAuth(request, networkPassphrase);

    // 4. Check auth entries and determine if we should simulate
    const authCheck = checkAuthAndSimDecision(request, extracted, sequenceAccount);

    // 5. Get the final transaction
    //    - If simulating: build new tx with sequence account and simulate
    //    - If not simulating: validate the existing transaction
    const finalTransaction = authCheck.shouldSimulate
      ? await simulateAndBuild(extracted, sequenceAccount, sequenceRelayer, rpc, networkPassphrase)
      : validateExistingTransaction(extracted.inputTx!); // We know inputTx exists if not simulating

    // 6. Calculate fee and submit with fee bump
    const fundRelayer = api.useRelayer(config.fundRelayerId);
    const fee = calculateFee(finalTransaction);

    const submission = await fundRelayer.sendTransaction({
      network: config.network,
      transaction_xdr: finalTransaction.toXDR(),
      fee_bump: true,
      max_fee: parseInt(fee.toString()),
    });
    // Release lock immediately after submission to avoid holding while waiting
    if (poolLock) {
      await pool.release(poolLock);
      poolLock = undefined;
    }

    try {
      const final = (await api.transactionWait(submission, {
        interval: 1000,
        timeout: 25000,
      })) as StellarTransactionResponse;

      // Check if transaction actually succeeded
      if (final.status === 'failed') {
        throw pluginError(final.status_reason || 'Transaction failed', {
          code: 'ONCHAIN_FAILED',
          status: 400,
          details: {
            status: String(final.status),
            reason: final.status_reason ?? null,
            id: final.id,
            hash: final.hash ?? null,
          },
        });
      }

      return {
        transactionId: final.id,
        status: final.status,
        hash: final.hash ?? null,
      };
    } catch (error: any) {
      throw pluginError('Transaction wait timeout. It may still submit.', {
        code: 'WAIT_TIMEOUT',
        status: 504,
        details: {
          id: submission.id,
          hash: submission.hash ?? null,
        },
      });
    }
  } finally {
    if (poolLock) {
      await pool.release(poolLock);
    }
  }
}

// Error-catching wrapper
export async function handler(context: PluginContext): Promise<any> {
  const result = await launchtube(context);
  return result;
}
