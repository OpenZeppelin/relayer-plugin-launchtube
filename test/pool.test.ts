import { FakeKV } from './helpers/fakeKv';
import { SequencePool } from '../src/pool';

describe('SequencePool', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.LOCK_TTL_SECONDS = '60';
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('acquire returns a lock with token and respects capacity', async () => {
    const kv = new FakeKV();
    const pool = new SequencePool('testnet', kv);
    await kv.set('testnet:sequence:relayer-ids', { relayerIds: ['p1', 'p2'] });

    const l1 = await pool.acquire();
    expect(['p1', 'p2']).toContain(l1.relayerId);
    expect(typeof l1.token).toBe('string');
    expect(l1.token.length).toBeGreaterThan(0);

    const l2 = await pool.acquire();
    expect(['p1', 'p2']).toContain(l2.relayerId);
    expect(l2.relayerId).not.toEqual(l1.relayerId);

    await expect(pool.acquire()).rejects.toThrow('Too many transactions queued');
  });

  test('release only deletes when token matches', async () => {
    const kv = new FakeKV();
    const pool = new SequencePool('testnet', kv);
    await kv.set('testnet:sequence:relayer-ids', { relayerIds: ['x'] });

    const l = await pool.acquire();
    // Wrong token should not delete
    await pool.release({ relayerId: l.relayerId, token: 'wrong' });
    const stillLocked = await kv.exists(`testnet:sequence:in-use:${l.relayerId}`);
    expect(stillLocked).toBe(true);

    // Correct token deletes
    await pool.release(l);
    const removed = await kv.exists(`testnet:sequence:in-use:${l.relayerId}`);
    expect(removed).toBe(false);
  });

  test('acquire throws when no relayerIds configured', async () => {
    const kv = new FakeKV();
    const pool = new SequencePool('testnet', kv);
    // No membership set
    await expect(pool.acquire()).rejects.toThrow('Too many transactions queued');
    // Explicit empty list
    await kv.set('testnet:sequence:relayer-ids', { relayerIds: [] });
    await expect(pool.acquire()).rejects.toThrow('Too many transactions queued');
  });

  test('membership is trimmed and deduplicated', async () => {
    const kv = new FakeKV();
    const pool = new SequencePool('testnet', kv);
    await kv.set('testnet:sequence:relayer-ids', { relayerIds: [' A ', 'A', 'b'] });

    const l1 = await pool.acquire();
    const l2 = await pool.acquire();
    expect([l1.relayerId, l2.relayerId].sort()).toEqual(['a', 'b']);
    await expect(pool.acquire()).rejects.toThrow('Too many transactions queued');
  });

  test('acquire skips already-locked IDs and selects another', async () => {
    const kv = new FakeKV();
    const pool = new SequencePool('testnet', kv);
    await kv.set('testnet:sequence:relayer-ids', { relayerIds: ['a', 'b'] });
    // Pre-lock 'a'
    await kv.set('testnet:sequence:in-use:a', { token: 't', lockedAt: new Date().toISOString() });

    const lock = await pool.acquire();
    expect(lock.relayerId).toBe('b');

    // Now both a and b are locked
    await expect(pool.acquire()).rejects.toThrow('Too many transactions queued');
  });

  test('reacquire after release returns the same ID when available', async () => {
    const kv = new FakeKV();
    const pool = new SequencePool('testnet', kv);
    await kv.set('testnet:sequence:relayer-ids', { relayerIds: ['x'] });

    const l1 = await pool.acquire();
    expect(l1.relayerId).toBe('x');
    await pool.release(l1);

    const l2 = await pool.acquire();
    expect(l2.relayerId).toBe('x');
  });

  test('release is idempotent and resilient to KV errors', async () => {
    const kv = new FakeKV();
    const pool = new SequencePool('testnet', kv as any);
    await kv.set('testnet:sequence:relayer-ids', { relayerIds: ['z'] });

    const l = await pool.acquire();
    // First release removes the key
    await expect(pool.release(l)).resolves.toBeUndefined();
    // Second release should no-op without throwing
    await expect(pool.release(l)).resolves.toBeUndefined();

    // Make KV.get throw to ensure release still does not throw
    const originalGet = (kv as any).get.bind(kv);
    (kv as any).get = async () => {
      throw new Error('boom');
    };
    await expect(pool.release(l)).resolves.toBeUndefined();
    // restore to avoid side effects
    (kv as any).get = originalGet;
  });
});
