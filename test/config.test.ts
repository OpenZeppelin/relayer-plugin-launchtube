import { getLockTtlSeconds, getNetworkPassphrase, loadConfig } from '../src/config';
import { Networks } from '@stellar/stellar-sdk';

describe('config', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    // Ensure clean slate
    delete process.env.STELLAR_NETWORK;
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.FUND_RELAYER_ID;
    delete process.env.LOCK_TTL_SECONDS;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('loadConfig success (case-insensitive network, trimmed values)', () => {
    process.env.STELLAR_NETWORK = 'TeStNeT';
    process.env.SOROBAN_RPC_URL = ' http://localhost:9999 ';
    process.env.FUND_RELAYER_ID = ' fund-relayer ';

    const cfg = loadConfig();
    expect(cfg.network).toBe('testnet');
    expect(cfg.rpcUrl).toBe('http://localhost:9999');
    expect(cfg.fundRelayerId).toBe('fund-relayer');
  });

  test('loadConfig throws for invalid STELLAR_NETWORK', () => {
    process.env.STELLAR_NETWORK = 'devnet';
    process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
    process.env.FUND_RELAYER_ID = 'relayer';
    expect(() => loadConfig()).toThrow('STELLAR_NETWORK must be "testnet" or "mainnet"');
  });

  test('loadConfig throws when STELLAR_NETWORK missing', () => {
    process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
    process.env.FUND_RELAYER_ID = 'relayer';
    expect(() => loadConfig()).toThrow('Missing required environment variable: STELLAR_NETWORK');
  });

  test('loadConfig throws when SOROBAN_RPC_URL missing', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.FUND_RELAYER_ID = 'relayer';
    expect(() => loadConfig()).toThrow('Missing required environment variable: SOROBAN_RPC_URL');
  });

  test('loadConfig throws when FUND_RELAYER_ID missing', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
    expect(() => loadConfig()).toThrow('Missing required environment variable: FUND_RELAYER_ID');
  });

  test('getNetworkPassphrase returns stellar passphrases', () => {
    expect(getNetworkPassphrase('testnet')).toBe(Networks.TESTNET);
    expect(getNetworkPassphrase('mainnet')).toBe(Networks.PUBLIC);
  });

  describe('getLockTtlSeconds', () => {
    test('default is 30 when unset', () => {
      delete process.env.LOCK_TTL_SECONDS;
      expect(getLockTtlSeconds()).toBe(30);
    });

    test('invalid number returns 30', () => {
      process.env.LOCK_TTL_SECONDS = 'abc';
      expect(getLockTtlSeconds()).toBe(30);
    });

    test('below min (<10) returns 30', () => {
      process.env.LOCK_TTL_SECONDS = '5';
      expect(getLockTtlSeconds()).toBe(30);
    });

    test('above max (>30) returns 30', () => {
      process.env.LOCK_TTL_SECONDS = '60';
      expect(getLockTtlSeconds()).toBe(30);
    });

    test('boundary and floor behavior', () => {
      process.env.LOCK_TTL_SECONDS = '10';
      expect(getLockTtlSeconds()).toBe(10);

      process.env.LOCK_TTL_SECONDS = '30';
      expect(getLockTtlSeconds()).toBe(30);

      process.env.LOCK_TTL_SECONDS = '29.9';
      expect(getLockTtlSeconds()).toBe(29);
    });
  });
});

