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
import { HTTP_STATUS, POLLING } from './constants';

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
    console.info(`[Launchtube] Processing ${request.type} request (sim=${request.sim})`);

    // 2. Get sequence account from pool
    poolLock = await pool.acquire();
    console.info(`[Launchtube] Acquired sequence account: ${poolLock.relayerId}`);
    const sequenceRelayer = api.useRelayer(poolLock.relayerId);
    const sequenceInfo = await sequenceRelayer.getRelayer();

    if (!sequenceInfo) {
      throw pluginError('Relayer not found', {
        code: 'RELAYER_UNAVAILABLE',
        status: HTTP_STATUS.BAD_GATEWAY,
        details: { relayerId: poolLock.relayerId },
      });
    }
    const sequenceStatus = await sequenceRelayer.getRelayerStatus();
    if (sequenceStatus.network_type !== 'stellar') {
      throw pluginError('Sequence network type is not supported', {
        code: 'UNSUPPORTED_NETWORK',
        status: HTTP_STATUS.BAD_REQUEST,
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
    console.info(`[Launchtube] Simulation: ${authCheck.shouldSimulate ? 'enabled' : 'disabled'}`);

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
    console.info(`[Launchtube] Transaction submitted: ${submission.id} (fee: ${fee})`);

    const final = await (async () => {
      try {
        return (await api.transactionWait(submission, {
          interval: POLLING.INTERVAL_MS,
          timeout: POLLING.TIMEOUT_MS,
        })) as StellarTransactionResponse;
      } catch (error: any) {
        console.error('Transaction wait error:', error);
        throw pluginError('Transaction wait timeout. It may still submit.', {
          code: 'WAIT_TIMEOUT',
          status: HTTP_STATUS.GATEWAY_TIMEOUT,
          details: {
            id: submission.id,
            hash: submission.hash ?? null,
            error: error?.message || String(error),
          },
        });
      }
    })();

    // Check if transaction actually succeeded
    if (final.status === 'failed') {
      throw pluginError(final.status_reason || 'Transaction failed on-chain', {
        code: 'ONCHAIN_FAILED',
        status: HTTP_STATUS.BAD_REQUEST,
        details: {
          status: String(final.status),
          reason: final.status_reason ?? null,
          id: final.id,
          hash: final.hash ?? null,
        },
      });
    }

    console.info(`[Launchtube] Transaction completed: ${final.status} (hash: ${final.hash || 'none'})`);
    return {
      transactionId: final.id,
      status: final.status,
      hash: final.hash ?? null,
    };
  } finally {
    if (poolLock) {
      await pool.release(poolLock);
      console.info(`[Launchtube] Released sequence account in cleanup: ${poolLock.relayerId}`);
    }
  }
}

// Error-catching wrapper
export async function handler(context: PluginContext): Promise<any> {
  const result = await launchtube(context);
  return result;
}
