/**
 * index.ts
 * 
 * Main entry point for the Launchtube plugin.
 * Orchestrates the transaction processing pipeline for Stellar/Soroban operations.
 */

import { PluginAPI } from '@openzeppelin/relayer-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { SequencePool } from './pool';
import { loadConfig, getNetworkPassphrase } from './config';
import { LaunchtubeResponse, RpcClient, SequenceAccount } from './types';
import { validateAndParseRequest } from './validation';
import { extractFunctionAndAuth } from './extraction';
import { checkAuthAndSimDecision } from './authCheck';
import { simulateAndBuild, validateExistingTransaction } from './simulation';
import { calculateFee } from './fee';

// Initialize dependencies
const config = loadConfig();

const SHARDS   = Number(process.env.SHARDS ?? '1');
const SHARD_ID = Number(process.env.SHARD_ID ?? '0');

function shard<T>(arr: T[], shards: number, shardId: number): T[] {
  if (shards <= 1) return arr.slice();
  const out: T[] = [];
  const sorted = arr.slice().sort();
  for (let i = 0; i < sorted.length; i++) {
    if (i % shards === shardId) out.push(sorted[i]);
  }
  return out;
}

const shardedSequenceIds = shard(config.sequenceRelayerIds, SHARDS, SHARD_ID);
if (shardedSequenceIds.length === 0) {
  throw new Error(`Shard ${SHARD_ID}/${SHARDS} has 0 sequence accounts — check SHARDS and the global list length.`);
}
console.log(`Launchtube shard init: shardId=${SHARD_ID} shards=${SHARDS} total=${config.sequenceRelayerIds.length} assigned=${shardedSequenceIds.length}`);

const pool = new SequencePool(shardedSequenceIds);

const rpc: RpcClient = new SorobanRpc.Server(config.rpcUrl);


async function launchtube(api: PluginAPI, params: any): Promise<LaunchtubeResponse> {
  let sequenceAccount: SequenceAccount | undefined;
  let poolAccount: { relayerId: string } | undefined;

  try {
    // 1. Validate and parse input into structured request
    const request = validateAndParseRequest(params);

    // 2. Get sequence account from pool
    poolAccount = await pool.acquire();
    const sequenceRelayer = api.useRelayer(poolAccount.relayerId);
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
      relayerId: poolAccount.relayerId,
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

    const result = await fundRelayer.sendTransaction({
      network: config.network,
      transaction_xdr: finalTransaction.toXDR(),
      fee_bump: true,
      max_fee: parseInt(fee.toString()),
    });

    return {
      transactionId: result.id,
      status: result.status,
      hash: result.hash,
    };
  } catch (error: any) {
    // Always release sequence account on error
    if (sequenceAccount) {
      pool.release(sequenceAccount);
    } else if (poolAccount) {
      // If we acquired from pool but didn't create sequenceAccount yet
      pool.release(poolAccount);
    }
    throw error;
  } finally {
    // Release sequence account when done
    if (sequenceAccount) {
      pool.release(sequenceAccount);
    }
  }
}

// Error-catching wrapper
export async function handler(api: PluginAPI, params: any): Promise<any> {
  try {
    const result = await launchtube(api, params);
    return result;
  } catch (error: any) {
    console.error(`Plugin error: ${error.message || error}`);
    const errorResult = {
      error: error.message || String(error),
      transactionId: null,
      status: 'failed',
    };
    return errorResult;
  }
}
