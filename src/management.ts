/**
 * management.ts
 *
 * Payload-based management API for sequence relayerIds.
 * - listSequenceAccounts: returns relayerIds from KV
 * - setSequenceAccounts: replaces relayerIds array in KV (checks lock conflicts)
 */

import type { PluginContext, PluginKVStore } from '@openzeppelin/relayer-sdk';
import { pluginError } from '@openzeppelin/relayer-sdk';
import { loadConfig } from './config';
import { HTTP_STATUS } from './constants';

function getAdminSecret(): string | undefined {
  const v = process.env.LAUNCHTUBE_ADMIN_SECRET;
  if (!v) return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function timingSafeEqual(a: string, b: string): boolean {
  // Basic constant-time comparison without crypto dep
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function isManagementRequest(params: any): boolean {
  return Boolean(
    params &&
      typeof params === 'object' &&
      (params as any).management &&
      typeof (params as any).management === 'object',
  );
}

export async function handleManagement(context: PluginContext): Promise<any> {
  const { kv, params } = context;
  const adminSecretEnv = getAdminSecret();
  if (!adminSecretEnv) {
    throw pluginError('Management API disabled', {
      code: 'MANAGEMENT_DISABLED',
      status: HTTP_STATUS.FORBIDDEN,
    });
  }

  const m = params?.management || {};
  const provided = (m.adminSecret ?? '').toString();
  if (!provided || !timingSafeEqual(provided, adminSecretEnv)) {
    throw pluginError('Unauthorized', { code: 'UNAUTHORIZED', status: HTTP_STATUS.UNAUTHORIZED });
  }

  const action = String(m.action || '');
  console.info(`[Launchtube] Management action: ${action}`);
  // Load config (requires env like STELLAR_NETWORK) after auth
  const cfg = loadConfig();
  switch (action) {
    case 'listSequenceAccounts':
      return await listSequenceAccounts(kv, cfg.network);
    case 'setSequenceAccounts':
      return await setSequenceAccounts(kv, cfg.network, m);
    default:
      throw pluginError('Invalid management action', { code: 'INVALID_ACTION', status: HTTP_STATUS.BAD_REQUEST });
  }
}

async function listSequenceAccounts(kv: PluginKVStore, network: 'testnet' | 'mainnet'): Promise<any> {
  const key = `${network}:sequence:relayer-ids`;
  try {
    const doc: any = await (kv as any).get?.(key);
    const relayerIds: string[] = Array.isArray(doc?.relayerIds) ? doc.relayerIds.map(normalizeId) : [];
    return { relayerIds };
  } catch (e: any) {
    throw pluginError('KV error while listing sequence accounts', {
      code: 'KV_ERROR',
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

async function setSequenceAccounts(kv: PluginKVStore, network: 'testnet' | 'mainnet', payload: any): Promise<any> {
  const incoming = payload?.relayerIds;
  if (!Array.isArray(incoming)) {
    throw pluginError('Invalid payload: relayerIds must be an array', {
      code: 'INVALID_PAYLOAD',
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }
  // Normalize, validate, unique
  const relayerIds = unique(incoming.map(normalizeId).filter(validRelayerId));

  // Read current
  const listKey = `${network}:sequence:relayer-ids`;
  const current = await readStoredRelayerIds(kv, listKey);

  // Check for locked removals
  const removals = current.filter((id) => !relayerIds.includes(id));
  const locked: string[] = [];
  for (const id of removals) {
    if (await isRelayerIdLocked(kv, network, id)) {
      locked.push(id);
    }
  }
  if (locked.length > 0) {
    throw pluginError('Locked relayer IDs cannot be removed', {
      code: 'LOCKED_CONFLICT',
      status: HTTP_STATUS.CONFLICT,
      details: { locked },
    });
  }

  // Write new list
  try {
    await kv.set(listKey, { relayerIds });
    console.info(`[Launchtube] Sequence accounts updated: ${relayerIds.length} accounts`);
    return { ok: true, appliedRelayerIds: relayerIds };
  } catch (e: any) {
    throw pluginError('KV error while saving sequence accounts', {
      code: 'KV_ERROR',
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

function normalizeId(id: string): string {
  return String(id).trim().toLowerCase();
}

function validRelayerId(id: string): boolean {
  if (!id) return false;
  if (id.length > 128) return false;
  return /^[a-z0-9:_-]+$/.test(id);
}

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

async function readStoredRelayerIds(kv: PluginKVStore, key: string): Promise<string[]> {
  try {
    const doc: any = await (kv as any).get?.(key);
    return Array.isArray(doc?.relayerIds) ? doc.relayerIds.map(normalizeId) : [];
  } catch (error) {
    throw pluginError('KV error while reading sequence accounts', {
      code: 'KV_ERROR',
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      details: { key, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function isRelayerIdLocked(kv: PluginKVStore, network: 'testnet' | 'mainnet', id: string): Promise<boolean> {
  const key = `${network}:sequence:in-use:${id}`;
  try {
    return await kv.exists(key);
  } catch (error) {
    throw pluginError('KV error while checking relayer lock', {
      code: 'KV_ERROR',
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      details: { relayerId: id, key, message: error instanceof Error ? error.message : String(error) },
    });
  }
}
