import { Keypair, xdr } from '@stellar/stellar-sdk';
import { checkAuthAndSimDecision } from '../src/authCheck';
import { AuthError, ExtractedData, LaunchtubeRequest, SequenceAccount } from '../src/types';

function makeSourceAccountAuthEntry(): any {
  return {
    credentials: () => ({
      switch: () => xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount(),
    }),
  } as any;
}

function makeAddressAuthEntryMatchingEd25519(rawPk: Buffer): any {
  return {
    credentials: () => ({
      switch: () => xdr.SorobanCredentialsType.sorobanCredentialsAddress(),
      address: () => ({
        address: () => ({
          switch: () => xdr.ScAddressType.scAddressTypeAccount(),
          accountId: () => ({
            switch: () => xdr.PublicKeyType.publicKeyTypeEd25519(),
            ed25519: () => rawPk,
          }),
        }),
      }),
    }),
  } as any;
}

describe('authCheck', () => {
  test('XDR+sim=true with source-account credentials forces no-sim', () => {
    const kp = Keypair.random();
    const sequence: SequenceAccount = { relayerId: 'r', address: kp.publicKey(), sequence: '1' };
    const extracted: ExtractedData = {
      func: {} as any,
      auth: [makeSourceAccountAuthEntry()],
      inputTx: { source: 'G' + 'X'.repeat(55), operations: [] } as any,
    };
    const request: LaunchtubeRequest = { type: 'xdr', xdr: 'X', sim: true };

    const res = checkAuthAndSimDecision(request, extracted, sequence);
    expect(res.shouldSimulate).toBe(false);
    expect(res.violations).toEqual([]);
  });

  test('func-auth always simulates even if source-account credentials present', () => {
    const kp = Keypair.random();
    const sequence: SequenceAccount = { relayerId: 'r', address: kp.publicKey(), sequence: '1' };
    const extracted: ExtractedData = { func: {} as any, auth: [makeSourceAccountAuthEntry()] };
    const request: LaunchtubeRequest = { type: 'func-auth', func: 'F', auth: [], sim: false };

    const res = checkAuthAndSimDecision(request, extracted, sequence);
    expect(res.shouldSimulate).toBe(true);
    expect(res.violations).toEqual([]);
  });

  test('violation when tx source equals sequence account with source-account credentials', () => {
    const kp = Keypair.random();
    const sequence: SequenceAccount = { relayerId: 'r', address: kp.publicKey(), sequence: '1' };
    const extracted: ExtractedData = {
      func: {} as any,
      auth: [makeSourceAccountAuthEntry()],
      inputTx: { source: sequence.address, operations: [] } as any,
    };
    const request: LaunchtubeRequest = { type: 'xdr', xdr: 'X', sim: true };

    expect(() => checkAuthAndSimDecision(request, extracted, sequence)).toThrow(AuthError);
  });

  test('violation when op source equals sequence account with source-account credentials', () => {
    const kp = Keypair.random();
    const sequence: SequenceAccount = { relayerId: 'r', address: kp.publicKey(), sequence: '1' };
    const extracted: ExtractedData = {
      func: {} as any,
      auth: [makeSourceAccountAuthEntry()],
      inputTx: { source: 'G' + 'A'.repeat(55), operations: [{ source: sequence.address }] } as any,
    };
    const request: LaunchtubeRequest = { type: 'xdr', xdr: 'X', sim: true };

    expect(() => checkAuthAndSimDecision(request, extracted, sequence)).toThrow(AuthError);
  });

  test('violation when address credentials matches sequence account', () => {
    const kp = Keypair.random();
    const sequence: SequenceAccount = { relayerId: 'r', address: kp.publicKey(), sequence: '1' };
    const addrAuth = makeAddressAuthEntryMatchingEd25519(Buffer.from(kp.rawPublicKey()));
    const extracted: ExtractedData = { func: {} as any, auth: [addrAuth] };
    const request: LaunchtubeRequest = { type: 'xdr', xdr: 'X', sim: true };

    expect(() => checkAuthAndSimDecision(request, extracted, sequence)).toThrow(AuthError);
  });
});
