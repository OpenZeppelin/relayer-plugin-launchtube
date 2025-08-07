/**
 * config.ts
 * 
 * Configuration loader for the Launchtube plugin.
 * Manages plugin settings including relayer IDs, network configuration, and RPC endpoints.
 */

import fs from 'fs';
import path from 'path';
import { Networks } from '@stellar/stellar-sdk';

export interface LaunchtubeConfig {
  fundRelayerId: string;
  sequenceRelayerIds: string[];
  maxFee: number;
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
}

/**
 * Load configuration from config.json
 */
export function loadConfig(): LaunchtubeConfig {
  // Search for config.json in multiple locations
  const possiblePaths = [
    // 1. Check plugins/launchtube directory (when used in relayer)
    path.join(process.cwd(), 'plugins', 'launchtube', 'config.json'),
    // 2. Check plugins directory 
    path.join(process.cwd(), 'plugins', 'config.json'),
    // 3. Current working directory
    path.join(process.cwd(), 'config.json'),
    // 4. Plugin's own directory (for local development)
    path.join(__dirname, '..', 'config.json'),
  ];

  let configPath: string | undefined;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      configPath = possiblePath;
      console.log(`Loading launchtube config from: ${configPath}`);
      break;
    }
  }

  if (!configPath) {
    throw new Error(
      `Configuration file not found. Searched in:\n` +
      possiblePaths.map(p => `  - ${p}`).join('\n') +
      `\n\nPlease create a config.json file in one of these locations.`
    );
  }

  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    // Validate required fields
    if (!config.fundRelayerId) {
      throw new Error('Missing fundRelayerId in config');
    }

    if (
      !config.sequenceRelayerIds ||
      !Array.isArray(config.sequenceRelayerIds) ||
      config.sequenceRelayerIds.length === 0
    ) {
      throw new Error('Missing or empty sequenceRelayerIds in config');
    }

    if (!config.network) {
      throw new Error('Missing network in config');
    }

    if (!config.rpcUrl) {
      throw new Error('Missing rpcUrl in config');
    }

    if (!config.maxFee) {
      throw new Error('Missing maxFee in config');
    }

    return {
      fundRelayerId: config.fundRelayerId,
      sequenceRelayerIds: config.sequenceRelayerIds,
      maxFee: config.maxFee,
      network: config.network,
      rpcUrl: config.rpcUrl,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get the network passphrase based on the configuration
 */
export function getNetworkPassphrase(network: 'testnet' | 'mainnet'): string {
  return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}
