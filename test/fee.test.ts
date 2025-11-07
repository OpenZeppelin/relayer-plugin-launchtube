import { calculateFee } from '../src/plugin/fee';
import { xdr } from '@stellar/stellar-sdk';

describe('fee', () => {
  const originalRandom = Math.random;
  afterEach(() => {
    Math.random = originalRandom;
  });

  test('with Soroban data: adds resource fee + base', () => {
    Math.random = () => 0; // baseFee = 205
    const tx: any = {
      toEnvelope: () => ({
        switch: () => xdr.EnvelopeType.envelopeTypeTx(),
        v1: () => ({
          tx: () => ({ ext: () => ({ sorobanData: () => ({ resourceFee: () => ({ toBigInt: () => 1000n }) }) }) }),
        }),
      }),
    };
    const fee = calculateFee(tx as any);
    expect(fee).toBe(1205n);
  });

  test('without Soroban data: adds 60000 + base', () => {
    Math.random = () => 0.5; // baseFee mid-range → 205..605
    const base = Math.floor(0.5 * (605 - 205 + 1)) + 205; // deterministic equivalent of getRandomNumber

    const tx: any = {
      toEnvelope: () => ({
        switch: () => xdr.EnvelopeType.envelopeTypeTx(),
        v1: () => ({ tx: () => ({ ext: () => ({ sorobanData: () => undefined }) }) }),
      }),
    };
    const fee = calculateFee(tx as any);
    expect(fee).toBe(BigInt(base + 60000));
  });
});
