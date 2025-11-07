/**
 * pool.ts
 *
 * KV-backed, stateless sequence pool.
 * - Membership comes from KV: <network>:sequence:relayer-ids
 * - Per-relayer locks with tokens: <network>:sequence:in-use:<relayerId>
 * - Uses a short global mutex to make acquire atomic across workers.
 */

import { PluginKVStore, pluginError } from '@openzeppelin/relayer-sdk';
import crypto from 'crypto';
import { getLockTtlSeconds } from './config';
import { HTTP_STATUS, POOL } from './constants';

export type PoolLock = { relayerId: string; token: string };

type MembershipDoc = { relayerIds: string[] };

export class SequencePool {
  private readonly network: 'testnet' | 'mainnet';
  private readonly globalLockKey: string;
  private readonly lockTtlSec: number;
  private readonly kv: PluginKVStore;

  constructor(network: 'testnet' | 'mainnet', kv: PluginKVStore) {
    this.network = network;
    this.kv = kv;
    this.globalLockKey = `${this.network}:sequence-pool-lock`;
    this.lockTtlSec = getLockTtlSeconds();
  }

  /** Acquire a relayerId with a token lock */
  async acquire(): Promise<PoolLock> {
    const result = await this.kv.withLock<PoolLock | null>(
      this.globalLockKey,
      async () => {
        const ids = await this.getRelayerIdsFromKV();
        if (ids.length === 0) {
          return null;
        }

        // Shuffle for basic fairness
        shuffle(ids);

        for (const relayerId of ids) {
          const key = this.lockKey(relayerId);
          const exists = await this.kv.exists(key);
          if (exists) continue;

          const token = randomToken();
          const entry = { token, lockedAt: new Date().toISOString() };
          await this.kv.set(key, entry, { ttlSec: this.lockTtlSec });
          return { relayerId, token };
        }
        return null;
      },
      { ttlSec: POOL.LOCK_TTL_SECONDS },
    );

    if (!result) {
      throw pluginError('Too many transactions queued. Please try again later', {
        code: 'POOL_CAPACITY',
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      });
    }

    return result;
  }

  /** Release the lock if we own it */
  async release(lock: PoolLock): Promise<void> {
    try {
      const key = this.lockKey(lock.relayerId);
      const current = await this.kv.get<{ token?: string }>(key);
      if (current?.token === lock.token) {
        await this.kv.del(key);
      }
    } catch {
      // ignore release errors
    }
  }

  private membershipKey(): string {
    return `${this.network}:sequence:relayer-ids`;
  }

  private lockKey(relayerId: string): string {
    return `${this.network}:sequence:in-use:${relayerId}`;
  }

  private async getRelayerIdsFromKV(): Promise<string[]> {
    try {
      const doc = await this.kv.get<MembershipDoc>(this.membershipKey());
      if (!doc || !Array.isArray(doc.relayerIds)) return [];
      // Normalize and unique
      const set = new Set<string>(doc.relayerIds.map(normalizeId));
      return Array.from(set.values());
    } catch {
      return [];
    }
  }
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function randomToken(): string {
  try {
    return crypto.randomBytes(16).toString('hex');
  } catch {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

function normalizeId(id: string): string {
  return String(id).trim().toLowerCase();
}
