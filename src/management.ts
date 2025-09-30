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
      status: 403,
    });
  }

  const m = params?.management || {};
  const provided = (m.adminSecret ?? '').toString();
  if (!provided || !timingSafeEqual(provided, adminSecretEnv)) {
    throw pluginError('Unauthorized', { code: 'UNAUTHORIZED', status: 401 });
  }

  const action = String(m.action || '');
  // Load config (requires env like STELLAR_NETWORK) after auth
  const cfg = loadConfig();
  switch (action) {
    case 'listSequenceAccounts':
      return await listSequenceAccounts(kv, cfg.network);
    case 'setSequenceAccounts':
      return await setSequenceAccounts(kv, cfg.network, m);
    default:
      throw pluginError('Invalid management action', { code: 'INVALID_ACTION', status: 400 });
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
      status: 500,
    });
  }
}

async function setSequenceAccounts(kv: PluginKVStore, network: 'testnet' | 'mainnet', payload: any): Promise<any> {
  const incoming = payload?.relayerIds;
  if (!Array.isArray(incoming)) {
    throw pluginError('Invalid payload: relayerIds must be an array', {
      code: 'INVALID_PAYLOAD',
      status: 400,
    });
  }
  // Normalize, validate, unique
  const relayerIds = unique(incoming.map(normalizeId).filter(validRelayerId));

  // Read current
  const listKey = `${network}:sequence:relayer-ids`;
  let current: string[] = [];
  try {
    const doc: any = await (kv as any).get?.(listKey);
    current = Array.isArray(doc?.relayerIds) ? doc.relayerIds.map(normalizeId) : [];
  } catch {
    /* ignore */
  }

  // Check for locked removals
  const removals = current.filter((id) => !relayerIds.includes(id));
  const locked: string[] = [];
  for (const id of removals) {
    try {
      if (await kv.exists(`${network}:sequence:in-use:${id}`)) {
        locked.push(id);
      }
    } catch {
      /* ignore exists errors */
    }
  }
  if (locked.length > 0) {
    throw pluginError('Locked relayer IDs cannot be removed', {
      code: 'LOCKED_CONFLICT',
      status: 409,
      details: { locked },
    });
  }

  // Write new list
  try {
    await kv.set(listKey, { relayerIds });
    return { ok: true, appliedRelayerIds: relayerIds };
  } catch (e: any) {
    throw pluginError('KV error while saving sequence accounts', {
      code: 'KV_ERROR',
      status: 500,
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
