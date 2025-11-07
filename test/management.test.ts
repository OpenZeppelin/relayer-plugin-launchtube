import { FakeKV } from './helpers/fakeKv';
import { handleManagement, isManagementRequest } from '../src/plugin/management';

const baseContext = (kv: any, params: any) => ({ kv, params }) as any;

describe('management API', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
    process.env.FUND_RELAYER_ID = 'fund-relayer';
    process.env.LAUNCHTUBE_ADMIN_SECRET = 'secret';
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('unauthorized when admin secret mismatches', async () => {
    const kv = new FakeKV();
    await expect(
      handleManagement(baseContext(kv, { management: { action: 'listSequenceAccounts', adminSecret: 'wrong' } })),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  test('management disabled when no LAUNCHTUBE_ADMIN_SECRET', async () => {
    delete process.env.LAUNCHTUBE_ADMIN_SECRET;
    const kv = new FakeKV();
    await expect(
      handleManagement(baseContext(kv, { management: { action: 'listSequenceAccounts', adminSecret: 'x' } })),
    ).rejects.toMatchObject({ status: 403, code: 'MANAGEMENT_DISABLED' });
  });

  test('list returns empty array when missing key', async () => {
    const kv = new FakeKV();
    const res = await handleManagement(
      baseContext(kv, { management: { action: 'listSequenceAccounts', adminSecret: 'secret' } }),
    );
    expect(res).toEqual({ relayerIds: [] });
  });

  test('set writes normalized unique relayerIds and list reflects it', async () => {
    const kv = new FakeKV();
    const setRes = await handleManagement(
      baseContext(kv, {
        management: {
          action: 'setSequenceAccounts',
          adminSecret: 'secret',
          relayerIds: [' ID1 ', 'id1', 'ID-2', 'bad*id'],
        },
      }),
    );
    expect(setRes).toEqual({ ok: true, appliedRelayerIds: ['id1', 'id-2'] });

    const listRes = await handleManagement(
      baseContext(kv, { management: { action: 'listSequenceAccounts', adminSecret: 'secret' } }),
    );
    expect(listRes).toEqual({ relayerIds: ['id1', 'id-2'] });
  });

  test('set rejects when removing locked relayerIds', async () => {
    const kv = new FakeKV();
    const listKey = `${process.env.STELLAR_NETWORK}:sequence:relayer-ids`;
    await kv.set(listKey, { relayerIds: ['a', 'b'] });
    await kv.set(`${process.env.STELLAR_NETWORK}:sequence:in-use:b`, {
      token: 't',
      lockedAt: new Date().toISOString(),
    });

    await expect(
      handleManagement(
        baseContext(kv, {
          management: { action: 'setSequenceAccounts', adminSecret: 'secret', relayerIds: ['a'] },
        }),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'LOCKED_CONFLICT', details: { locked: ['b'] } });

    const listAfter = await handleManagement(
      baseContext(kv, { management: { action: 'listSequenceAccounts', adminSecret: 'secret' } }),
    );
    expect(listAfter).toEqual({ relayerIds: ['a', 'b'] });
  });

  test('invalid_action returns error', async () => {
    const kv = new FakeKV();
    await expect(
      handleManagement(baseContext(kv, { management: { action: 'nope', adminSecret: 'secret' } })),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_ACTION' });
  });

  test('invalid_payload on set without relayerIds', async () => {
    const kv = new FakeKV();
    await expect(
      handleManagement(baseContext(kv, { management: { action: 'setSequenceAccounts', adminSecret: 'secret' } })),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_PAYLOAD' });
  });

  test('list normalizes duplicates and casing from KV doc', async () => {
    const kv = new FakeKV();
    const key = `${process.env.STELLAR_NETWORK}:sequence:relayer-ids`;
    await kv.set(key, { relayerIds: ['A', 'a', 'B'] });
    const res = await handleManagement(
      baseContext(kv, { management: { action: 'listSequenceAccounts', adminSecret: 'secret' } }),
    );
    // list normalizes (lowercases) but does not unique
    expect(res).toEqual({ relayerIds: ['a', 'a', 'b'] });
  });

  test('isManagementRequest detection', () => {
    expect(isManagementRequest(undefined as any)).toBe(false);
    expect(isManagementRequest({})).toBe(false);
    expect(isManagementRequest({ management: {} })).toBe(true);
  });

  test('set succeeds when there are no removals even if some IDs are locked', async () => {
    const kv = new FakeKV();
    const listKey = `${process.env.STELLAR_NETWORK}:sequence:relayer-ids`;
    // Current membership
    await kv.set(listKey, { relayerIds: ['a', 'b'] });
    // Lock 'b'
    await kv.set(`${process.env.STELLAR_NETWORK}:sequence:in-use:b`, {
      token: 't',
      lockedAt: new Date().toISOString(),
    });

    // No removals (same list) should succeed
    const res = await handleManagement(
      baseContext(kv, {
        management: { action: 'setSequenceAccounts', adminSecret: 'secret', relayerIds: ['a', 'b'] },
      }),
    );
    expect(res).toEqual({ ok: true, appliedRelayerIds: ['a', 'b'] });
  });

  test('add-only update succeeds while existing IDs are locked', async () => {
    const kv = new FakeKV();
    const listKey = `${process.env.STELLAR_NETWORK}:sequence:relayer-ids`;
    await kv.set(listKey, { relayerIds: ['a', 'b'] });
    await kv.set(`${process.env.STELLAR_NETWORK}:sequence:in-use:b`, {
      token: 't',
      lockedAt: new Date().toISOString(),
    });

    // Add 'c' without removing any existing locked ids
    const res = await handleManagement(
      baseContext(kv, {
        management: { action: 'setSequenceAccounts', adminSecret: 'secret', relayerIds: ['a', 'b', 'c'] },
      }),
    );

    expect(res).toEqual({ ok: true, appliedRelayerIds: ['a', 'b', 'c'] });
  });
});
