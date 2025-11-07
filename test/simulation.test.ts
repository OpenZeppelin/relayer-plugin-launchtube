import { Account, Contract, Keypair, Networks, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { simulateAndBuild, validateExistingTransaction } from '../src/plugin/simulation';
import type { ExtractedData, RpcClient } from '../src/plugin/types';

function buildInvokeHostFunctionOp() {
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), '0');
  const op = new Contract('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC').call('noop');
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const builtOp = tx.operations[0] as Operation.InvokeHostFunction;
  return { func: builtOp.func, auth: builtOp.auth };
}

describe('simulation: validateExistingTransaction', () => {
  test('rejects invalid envelope type', () => {
    const tx: any = {
      toEnvelope: () => ({ switch: () => xdr.EnvelopeType.envelopeTypeTxFeeBump() }),
    };
    expect(() => validateExistingTransaction(tx)).toThrow('Invalid transaction envelope type');
  });

  test('rejects when fee > resourceFee + 201', () => {
    const tx: any = {
      fee: '1203',
      toEnvelope: () => ({
        switch: () => xdr.EnvelopeType.envelopeTypeTx(),
        v1: () => ({
          tx: () => ({
            ext: () => ({
              sorobanData: () => ({ resourceFee: () => ({ toBigInt: () => 1001n }) }),
            }),
          }),
        }),
      }),
    };
    expect(() => validateExistingTransaction(tx)).toThrow('Transaction fee must be equal to the resource fee');
  });

  test('rejects when timeBounds.maxTime > 30s in future', () => {
    const now = Math.floor(Date.now() / 1000);
    const tx: any = {
      fee: '100',
      timeBounds: { minTime: 0, maxTime: now + 31 },
      toEnvelope: () => ({
        switch: () => xdr.EnvelopeType.envelopeTypeTx(),
        v1: () => ({ tx: () => ({ ext: () => ({ sorobanData: () => undefined }) }) }),
      }),
    };
    expect(() => validateExistingTransaction(tx)).toThrow(
      'Transaction `timeBounds.maxTime` too far into the future. Must be no greater than 30 seconds',
    );
  });

  test('returns the same transaction for valid constraints', () => {
    const now = Math.floor(Date.now() / 1000);
    const tx: any = {
      fee: '100',
      timeBounds: { minTime: 0, maxTime: now + 30 },
      toEnvelope: () => ({
        switch: () => xdr.EnvelopeType.envelopeTypeTx(),
        v1: () => ({ tx: () => ({ ext: () => ({ sorobanData: () => undefined }) }) }),
      }),
    };
    const out = validateExistingTransaction(tx);
    expect(out).toBe(tx);
  });
});

describe('simulation: simulateAndBuild', () => {
  test('success flow signs and returns a transaction', async () => {
    const { func, auth } = buildInvokeHostFunctionOp();
    const extracted: ExtractedData = { func, auth, inputTx: undefined };

    const rpc: RpcClient = {
      simulateTransaction: async () =>
        ({
          // Match expected shape: no error/restore, has transactionData and result.auth
          transactionData: {
            build: () => ({
              resourceFee: () => ({ toBigInt: () => 1234n }),
              // Provide a toXDR to be safe in case builder inspects it
              toXDR: () => Buffer.from('00', 'hex'),
            }),
          },
          result: { auth },
        }) as any,
    };

    const sequenceRelayer: any = {
      signTransaction: jest.fn(async ({ unsigned_xdr }: any) => ({ signedXdr: unsigned_xdr })),
    };

    const spy = jest.spyOn(TransactionBuilder, 'cloneFrom').mockReturnValue({
      build: () => {
        // Build a minimal tx to return
        const kp = Keypair.random();
        const account = new Account(kp.publicKey(), '1');
        return new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
          .addOperation(Operation.invokeHostFunction({ func, auth }))
          .setTimeout(30)
          .build();
      },
    } as any);

    const sequence = { relayerId: 'r', address: Keypair.random().publicKey(), sequence: '1' };
    const tx = await simulateAndBuild(extracted, sequence as any, sequenceRelayer, rpc, Networks.TESTNET);
    expect(tx).toBeDefined();
    expect(sequenceRelayer.signTransaction).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('throws on simulation error (no transactionData)', async () => {
    const { func, auth } = buildInvokeHostFunctionOp();
    const extracted: ExtractedData = { func, auth, inputTx: undefined };
    const rpc: RpcClient = {
      simulateTransaction: async () => ({ result: { auth } }) as any,
    };
    const sequenceRelayer: any = { signTransaction: async () => ({ signedXdr: '' }) };
    const sequence = { relayerId: 'r', address: Keypair.random().publicKey(), sequence: '1' };
    await expect(simulateAndBuild(extracted, sequence as any, sequenceRelayer, rpc, Networks.TESTNET)).rejects.toThrow(
      'No transaction data from simulation',
    );
  });

  test('throws when provided auth mismatches simulation auth', async () => {
    const { func } = buildInvokeHostFunctionOp();
    const fakeAuth: any = [{ toXDR: () => 'AAA' }];
    const extracted: ExtractedData = { func, auth: fakeAuth, inputTx: undefined } as any;
    const rpc: RpcClient = {
      simulateTransaction: async () =>
        ({
          transactionData: { build: () => ({ resourceFee: () => ({ toBigInt: () => 1n }) }) },
          result: { auth: [] }, // mismatch
        }) as any,
    };
    const sequenceRelayer: any = { signTransaction: async () => ({ signedXdr: '' }) };
    const sequence = { relayerId: 'r', address: Keypair.random().publicKey(), sequence: '1' };
    await expect(simulateAndBuild(extracted, sequence as any, sequenceRelayer, rpc, Networks.TESTNET)).rejects.toThrow(
      'Auth invalid',
    );
  });
});
