import type { PluginKVStore } from '@openzeppelin/relayer-sdk';

export class FakeKV implements PluginKVStore {
  private store = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | null> {
    return this.store.has(key) ? (this.store.get(key) as T) : null;
  }

  async set(key: string, value: unknown): Promise<boolean> {
    if (value === undefined) throw new Error('FakeKV: cannot set undefined');
    this.store.set(key, value);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async del(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async listKeys(_pattern = '*', _batch = 500): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async clear(): Promise<number> {
    const n = this.store.size;
    this.store.clear();
    return n;
  }

  async withLock<T>(
    _key: string,
    fn: () => Promise<T>,
    _opts?: { ttlSec?: number; onBusy?: 'throw' | 'skip' },
  ): Promise<T | null> {
    return await fn();
  }
}
