/**
 * types.ts
 *
 * Type definitions for the Launchtube plugin.
 * Defines request/response structures, error types, and shared interfaces.
 */

import { Transaction, SorobanRpc, xdr } from '@stellar/stellar-sdk';

// Clear request types - either XDR or func+auth
export type LaunchtubeRequest =
  | { type: 'xdr'; xdr: string; sim: boolean }
  | { type: 'func-auth'; func: string; auth: string[]; sim: boolean };

// What we extract from either request type
export type ExtractedData = {
  func: xdr.HostFunction;
  auth: xdr.SorobanAuthorizationEntry[] | undefined;
  inputTx?: Transaction; // Only present for XDR requests
};

// Result of auth checking
export type AuthCheckResult = {
  shouldSimulate: boolean;
  violations: string[]; // Any auth violations found
};

// Sequence account from the pool
export type SequenceAccount = {
  relayerId: string;
  address: string;
  sequence: string;
};

// Final response
export type LaunchtubeResponse = {
  transactionId: string | null;
  status: string | null;
  hash: string | null;
};

// External dependencies
export interface RpcClient {
  simulateTransaction(tx: Transaction): Promise<SorobanRpc.Api.SimulateTransactionResponse>;
}
