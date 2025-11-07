import { Account, Contract, Keypair, Networks, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { extractFunctionAndAuth } from '../src/plugin/extraction';

const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

function buildInvokeHostFunctionTx() {
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), '0');
  const op = new Contract(CONTRACT_ID).call('noop');
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const builtOp = tx.operations[0] as Operation.InvokeHostFunction;
  return { tx, op: builtOp };
}

describe('extraction', () => {
  test('xdr request: extracts func/auth and inputTx with single invoke op', () => {
    const { tx, op } = buildInvokeHostFunctionTx();
    const res = extractFunctionAndAuth({ type: 'xdr', xdr: tx.toXDR(), sim: true }, Networks.TESTNET);

    expect(res.inputTx).toBeDefined();
    expect(res.func.switch()).toBe(xdr.HostFunctionType.hostFunctionTypeInvokeContract());
    expect((res.auth || []).map((a) => a.toXDR('base64'))).toEqual((op.auth || []).map((a) => a.toXDR('base64')));
  });

  test('xdr request: rejects non-invoke operation', () => {
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), '0');
    const nonInvoke = Operation.createAccount({ destination: Keypair.random().publicKey(), startingBalance: '1' });
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(nonInvoke)
      .setTimeout(30)
      .build();

    expect(() => extractFunctionAndAuth({ type: 'xdr', xdr: tx.toXDR(), sim: true }, Networks.TESTNET)).toThrow(
      'Must include only one operation of type `invokeHostFunction`',
    );
  });

  test('xdr request: rejects multiple operations', () => {
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), '0');
    const op1 = Operation.createAccount({ destination: Keypair.random().publicKey(), startingBalance: '1' });
    const op2 = Operation.createAccount({ destination: Keypair.random().publicKey(), startingBalance: '1' });
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(op1)
      .addOperation(op2)
      .setTimeout(30)
      .build();

    expect(() => extractFunctionAndAuth({ type: 'xdr', xdr: tx.toXDR(), sim: true }, Networks.TESTNET)).toThrow(
      'Must include only one Soroban operation',
    );
  });

  test('func+auth request: decodes base64 func and auth', () => {
    const { op } = buildInvokeHostFunctionTx();
    const funcB64 = op.func.toXDR('base64');
    const authB64 = (op.auth || []).map((a: xdr.SorobanAuthorizationEntry) => a.toXDR('base64'));

    const res = extractFunctionAndAuth(
      { type: 'func-auth', func: funcB64, auth: authB64, sim: true },
      Networks.TESTNET,
    );
    expect(res.inputTx).toBeUndefined();
    expect(res.func.switch()).toBe(xdr.HostFunctionType.hostFunctionTypeInvokeContract());
    expect((res.auth || []).map((a) => a.toXDR('base64'))).toEqual(authB64);
  });
});
