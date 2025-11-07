import type { LogEntry } from '@openzeppelin/relayer-sdk';

/**
 * Configuration for LaunchtubeClient in direct HTTP mode
 */
export interface DirectHttpConfig {
  /** Base URL for Launchtube service */
  baseUrl: string;
  /** API key for Launchtube service */
  apiKey: string;
  /** Optional admin secret for management operations */
  adminSecret?: string;
  /** Optional request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Configuration for LaunchtubeClient in relayer mode
 */
export interface RelayerConfig {
  /** Plugin ID in the OpenZeppelin Relayer */
  pluginId: string;
  /** API key for OpenZeppelin Relayer */
  apiKey: string;
  /** Base URL for OpenZeppelin Relayer */
  baseUrl: string;
  /** Optional admin secret for management operations */
  adminSecret?: string;
  /** Optional request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Configuration for LaunchtubeClient
 * The client automatically detects the mode:
 * - If pluginId is provided → relayer mode
 * - Otherwise → direct HTTP mode
 */
export type LaunchtubeClientConfig = DirectHttpConfig | RelayerConfig;

/**
 * Core Launchtube transaction request payload
 */
export interface LaunchtubeTransactionRequest {
  /** Complete transaction envelope XDR (mutually exclusive with func+auth) */
  xdr?: string;
  /** Soroban host function XDR (requires auth) */
  func?: string;
  /** Array of authorization entry XDRs (requires func) */
  auth?: string[];
  /** Whether to simulate before submission */
  sim: boolean;
}

/**
 * Response from transaction submission
 */
export interface LaunchtubeTransactionResponse {
  /** Transaction ID from the relayer */
  transactionId: string | null;
  /** Transaction hash on-chain */
  hash: string | null;
  /** Transaction status */
  status: string | null;
  /** Optional metadata (logs and traces) */
  metadata?: {
    logs?: LogEntry[];
    traces?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/**
 * Response from listing sequence accounts
 */
export interface ListSequenceAccountsResponse {
  /** Array of relayer IDs currently configured as sequence accounts */
  relayerIds: string[];
  /** Optional metadata (logs and traces) */
  metadata?: {
    logs?: LogEntry[];
    traces?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/**
 * Response from setting sequence accounts
 */
export interface SetSequenceAccountsResponse {
  /** Success indicator */
  ok: boolean;
  /** Array of relayer IDs that were applied */
  appliedRelayerIds: string[];
  /** Optional metadata (logs and traces) */
  metadata?: {
    logs?: LogEntry[];
    traces?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/**
 * Plugin response structure for successful operations
 */
export interface PluginResponseSuccess<T> {
  success: true;
  data: T;
  metadata?: {
    logs?: LogEntry[];
    traces?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/**
 * Plugin response structure for failed operations
 */
export interface PluginResponseError {
  success: false;
  error: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Discriminated union type for all plugin responses
 * Enables type-safe handling of success/error cases
 */
export type PluginResponse<T> = PluginResponseSuccess<T> | PluginResponseError;
