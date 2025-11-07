/**
 * config.ts
 *
 * Environment-driven configuration for the Launchtube plugin.
 * Removes legacy config.json usage and relies on env vars.
 */

import { Networks } from '@stellar/stellar-sdk';
import { pluginError } from '@openzeppelin/relayer-sdk';
import { HTTP_STATUS, CONFIG } from './constants';

export interface LaunchtubeConfig {
  fundRelayerId: string;
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw pluginError(`Missing required environment variable: ${name}`, {
      code: 'CONFIG_MISSING',
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      details: { name },
    });
  }
  return v.trim();
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): LaunchtubeConfig {
  const networkRaw = requireEnv('STELLAR_NETWORK').toLowerCase();
  if (networkRaw !== 'testnet' && networkRaw !== 'mainnet') {
    throw pluginError('STELLAR_NETWORK must be "testnet" or "mainnet"', {
      code: 'UNSUPPORTED_NETWORK',
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }

  const rpcUrl = requireEnv('SOROBAN_RPC_URL');
  const fundRelayerId = requireEnv('FUND_RELAYER_ID');

  return {
    fundRelayerId,
    network: networkRaw as 'testnet' | 'mainnet',
    rpcUrl,
  };
}

/**
 * Get the network passphrase based on the configuration
 */
export function getNetworkPassphrase(network: 'testnet' | 'mainnet'): string {
  return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

/** Convenience: per-relayer lock TTL in seconds (default 30) */
export function getLockTtlSeconds(): number {
  const raw = process.env.LOCK_TTL_SECONDS;
  if (!raw) return CONFIG.DEFAULT_LOCK_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < CONFIG.MIN_LOCK_TTL_SECONDS || n > CONFIG.MAX_LOCK_TTL_SECONDS) {
    return CONFIG.DEFAULT_LOCK_TTL_SECONDS;
  }
  return Math.floor(n);
}
