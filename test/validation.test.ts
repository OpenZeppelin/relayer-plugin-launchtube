import { validateAndParseRequest } from '../src/plugin/validation';

describe('validation', () => {
  test('xdr path: sim defaults to true', () => {
    const out = validateAndParseRequest({ xdr: 'BASE64XDR' });
    expect(out).toEqual({ type: 'xdr', xdr: 'BASE64XDR', sim: true });
  });

  test('xdr path: sim=false is respected', () => {
    const out = validateAndParseRequest({ xdr: 'BASE64XDR', sim: false });
    expect(out).toEqual({ type: 'xdr', xdr: 'BASE64XDR', sim: false });
  });

  test('func+auth path: returns structured request and sim default', () => {
    const out = validateAndParseRequest({ func: 'BASE64FUNC', auth: [] });
    expect(out).toEqual({ type: 'func-auth', func: 'BASE64FUNC', auth: [], sim: true });
  });

  test('error: sim=false without xdr', () => {
    try {
      validateAndParseRequest({ sim: false } as any);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('Cannot pass `sim = false` without `xdr`');
      expect(e.status).toBe(400);
      expect(e.code).toBe('INVALID_PARAMS');
    }
  });

  test('error: xdr with func or auth present', () => {
    expect(() => validateAndParseRequest({ xdr: 'X', func: 'F' } as any)).toThrow(
      '`func` and `auth` must be omitted when passing `xdr`',
    );
    expect(() => validateAndParseRequest({ xdr: 'X', auth: [] } as any)).toThrow(
      '`func` and `auth` must be omitted when passing `xdr`',
    );
  });

  test('error: neither xdr nor func+auth provided', () => {
    expect(() => validateAndParseRequest({} as any)).toThrow('Must pass either `xdr` or `func` and `auth`');
  });

  test('error: missing one of func/auth when omitting xdr', () => {
    expect(() => validateAndParseRequest({ func: 'F' } as any)).toThrow(
      '`func` and `auth` are both required when omitting `xdr`',
    );
    expect(() => validateAndParseRequest({ auth: [] } as any)).toThrow(
      '`func` and `auth` are both required when omitting `xdr`',
    );
  });
});
