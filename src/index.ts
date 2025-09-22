/**
 * index.ts
 *
 * Main entry point for the Launchtube plugin.
 * Orchestrates the transaction processing pipeline for Stellar/Soroban operations.
 */

import type { StellarTransactionResponse, PluginContext } from '@openzeppelin/relayer-sdk';
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
      throw new Error('No sequence info found');
    }
    const sequenceStatus = await sequenceRelayer.getRelayerStatus();
    if (sequenceStatus.network_type !== 'stellar') {
      throw new Error('Sequence network type is not supported');
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

    console.log('Transaction details:', {
      hasSorobanData: !!finalTransaction.toEnvelope().v1()?.tx().ext().sorobanData(),
      fee: fee.toString(),
      hasSignatures: finalTransaction.signatures.length > 0,
      operationType: finalTransaction.operations[0]?.type,
      source: finalTransaction.source,
      sequence: finalTransaction.sequence,
    });

    console.log('Final transaction XDR:', finalTransaction.toXDR());

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

    // 7. Use relayer's transactionWait (debug)
    try {
      const final = (await api.transactionWait(submission, {
        interval: 500,
        timeout: 25000,
      })) as StellarTransactionResponse;
      return {
        transactionId: final.id,
        hash: final.hash ?? null,
      };
    } catch (error) {
      return {
        transactionId: submission.id,
        hash: submission.hash ?? null,
        error: 'Transaction was queued, but waiting for submission failed. It may still submit.',
      };
    }
  } finally {
    if (poolLock) {
      await pool.release(poolLock);
    }
  }
}

// Error-catching wrapper
export async function handler(context: PluginContext): Promise<any> {
  try {
    const result = await launchtube(context);
    return result;
  } catch (error: any) {
    console.error(`Plugin error: ${error.message || error}`);
    const errorResult = {
      error: error.message || String(error),
      transactionId: null,
      hash: null,
    };
    return errorResult;
  }
}
