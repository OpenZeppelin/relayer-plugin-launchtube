import { execSync } from 'child_process';
import axios from 'axios';
import {
  Keypair,
  TransactionBuilder,
  Networks,
  Address,
  SorobanRpc,
  Contract,
  xdr,
  Operation,
  scValToNative,
  authorizeEntry,
} from '@stellar/stellar-sdk';

/*
 ═══════════════════════════════════════════════════════════════════════════
 Launchtube Plugin E2E Test Suite
 ═══════════════════════════════════════════════════════════════════════════

 WHAT THIS DOES
 ──────────────
 Tests your deployed Launchtube relayer plugin by:
   ✓ Sending contract invocations through the plugin
   ✓ Verifying the plugin correctly processes transactions
   ✓ Testing both valid and invalid inputs (negative cases)
   ✓ Confirming results by reading contract state

 BEFORE YOU RUN
 ───────────────
 1. Have a Stellar key: stellar keys generate <name>
 2. Fund it on testnet: https://friendbot.stellar.org
 3. Deploy the lt-e2e test contract
 4. Start your relayer with the Launchtube plugin enabled

 QUICK START
 ───────────
 tsx scripts/e2e.ts \
   --contract-id <YOUR_CONTRACT_ID> \
   --api-key <YOUR_API_KEY> \
   --account-name <YOUR_KEY_NAME>

 OPTIONS
 ───────
 Required:
   --contract-id <ID>       Deployed lt-e2e contract address
   --api-key <KEY>          Your relayer API key

 Optional:
   --account-name <NAME>    Stellar key to use (default: "default")
   --network <NET>          testnet or mainnet (default: testnet)
   --base-url <URL>         Relayer URL (default: http://localhost:8080)
   --rpc-url <URL>          Custom Soroban RPC endpoint
   --debug                  Show detailed transaction and plugin logs
   --list                   Show all available tests and exit
   --only <ID,...>          Run specific test(s) only
   --help                   Show this help

 Environment variables: API_KEY, BASE_URL, NETWORK, RPC_URL, ACCOUNT_NAME

 EXAMPLES
 ────────
 # Run all tests with debug output
 tsx scripts/e2e.ts \
   --contract-id CD5Q... \
   --api-key abc123 \
   --account-name test-key \
   --debug

 # List available tests
 tsx scripts/e2e.ts --list

 # Run just one specific test
 tsx scripts/e2e.ts \
   --contract-id CD5Q... \
   --api-key abc123 \
   --only func-auth-sim

 # Test against mainnet with custom RPC
 tsx scripts/e2e.ts \
   --contract-id CC... \
   --api-key abc123 \
   --network mainnet \
   --rpc-url https://mainnet.sorobanrpc.com

 ═══════════════════════════════════════════════════════════════════════════
*/

type ArgMap = Record<string, string | boolean>;

type Ctx = {
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  baseUrl: string;
  apiKey: string;
  accountName: string;
  contractIdArg: string;
  rpc: SorobanRpc.Server;
};

type TestEnv = {
  ctx: Ctx;
  contractId: string;
  keypair: Keypair;
  address: string;
  contract: Contract;
  debug: boolean;
};

type TestCase = {
  id: string;
  label: string;
  run: (env: TestEnv) => Promise<void>;
};

type ContractInvokeOp = ReturnType<Contract['call']>;

const TEST_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'func-auth-sim', label: 'func+auth sim=true' },
  { id: 'xdr-signed-nosim', label: 'xdr sim=false (pre‑assembled)' },
  { id: 'xdr-sim-no-auth', label: 'xdr sim=true (no auth)' },
  { id: 'xdr-sim-source-auth', label: 'xdr sim=true with source-account auth (auto no-sim)' },
  { id: 'neg-func-auth-nosim', label: 'Negative: func+auth sim=false rejected' },
  { id: 'neg-xdr-two-ops', label: 'Negative: xdr with two ops rejected' },
  { id: 'neg-xdr-far-timebounds', label: 'Negative: xdr sim=false with far timebounds rejected' },
];

const PASS = '✅';
const FAIL = '❌';

function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.includes('=') ? a.split('=') : [a, undefined];
    const key = k.replace(/^--/, '').trim();
    if (v !== undefined) out[key] = v;
    else {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function usage(): void {
  console.log(
    `Usage: ts-node scripts/e2e-plugin-full.ts [options]\n\nOptions:\n  --contract-id CG...         Contract ID to test (required)\n  --network <testnet|mainnet> Network (default: testnet)\n  --rpc-url <url>             Soroban RPC URL\n  --base-url <url>            Relayer base URL (e.g., http://localhost:8080)\n  --api-key <key>             Relayer API key (required)\n  --account-name <name>       stellar keys alias (default: default)\n  --list                      List available test IDs and exit\n  --only <id[,id2,...]>       Run only the specified test ID(s)\n  --debug                     Print detailed XDR/operation diagnostics\n  --help                      Show this help\n\nNotes:\n  - Requires a local stellar key (see: \`stellar keys generate <name>\`).\n  - On testnet, ensure the key has XLM balance (friendbot: https://friendbot.stellar.org).\n  - Provide --api-key (or API_KEY env).\n  - Pass an existing contract id via --contract-id.\n`,
  );
}

function getConfigFromEnvArgs(): Omit<Ctx, 'rpc'> {
  const args = parseArgs(process.argv.slice(2));
  if (args['help']) {
    usage();
    process.exit(0);
  }
  const network: 'testnet' | 'mainnet' =
    ((args['network'] as any) || process.env.NETWORK) === 'mainnet' ? 'mainnet' : 'testnet';
  const rpcUrl =
    (args['rpc-url'] as string) ||
    process.env.RPC_URL ||
    (network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
  const baseUrlRaw = (args['base-url'] as string) || process.env.BASE_URL || 'http://localhost:8080';
  const baseUrl = baseUrlRaw.replace(/\/$/, '');
  const apiKey = (args['api-key'] as string) || process.env.API_KEY || '';
  const accountName = (args['account-name'] as string) || process.env.ACCOUNT_NAME || 'default';
  const contractIdArg = (args['contract-id'] as string) || '';
  return {
    network,
    rpcUrl,
    baseUrl,
    apiKey,
    accountName,
    contractIdArg,
  };
}

function getNetworkPassphrase(ctx: Ctx): string {
  return ctx.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

async function callPlugin(ctx: Ctx, params: any): Promise<any> {
  const endpoint = `${ctx.baseUrl}/api/v1/plugins/launchtube-plugin/call`;
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.apiKey}` };
  headers['X-Request-Id'] = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const res = await axios.post(
    endpoint,
    { params },
    {
      headers,
      timeout: 15000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    },
  );
  return res.data;
}

function unwrapReturnValue(response: any): any {
  const rv = response?.data?.return_value;
  if (typeof rv === 'string') {
    try {
      return JSON.parse(rv);
    } catch (e) {
      // Ignore JSON parse errors; return raw string
    }
    return rv;
  }
  return rv ?? response;
}

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();
}

function getKeypair(accountName: string) {
  const address = sh(`stellar keys address ${accountName}`);
  const secret = sh(`stellar keys show ${accountName}`);
  return { keypair: Keypair.fromSecret(secret), address };
}

function keyExists(accountName: string): boolean {
  try {
    sh(`stellar keys address ${accountName}`);
    return true;
  } catch {
    return false;
  }
}

function buildClient(contractId: string) {
  return new Contract(contractId);
}

async function simulateAndAssemble(ctx: Ctx, tx: any) {
  const sim = await ctx.rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${JSON.stringify(sim.error)}`);
  return SorobanRpc.assembleTransaction(tx, sim).build();
}

async function readValue(ctx: Ctx, contractId: string, callerAddress: string, targetAddress: string): Promise<number> {
  const CONTRACT = buildClient(contractId);
  const acct = await ctx.rpc.getAccount(callerAddress);
  const tx = new TransactionBuilder(acct, { fee: '100', networkPassphrase: getNetworkPassphrase(ctx) })
    .addOperation(CONTRACT.call('read_value', Address.fromString(targetAddress).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await ctx.rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error('read_value simulation failed');
  const retval = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (!retval) throw new Error('read_value returned no retval');
  const native = scValToNative(retval);
  return Number(native);
}

async function buildTxWithOps(ctx: Ctx, sourceAddress: string, ops: ContractInvokeOp[], timeoutSeconds = 30) {
  const acct = await ctx.rpc.getAccount(sourceAddress);
  let builder = new TransactionBuilder(acct, { fee: '100', networkPassphrase: getNetworkPassphrase(ctx) });
  for (const op of ops) builder = builder.addOperation(op);
  return builder.setTimeout(timeoutSeconds).build();
}

async function assertStoredValue(ctx: Ctx, contractId: string, address: string, expected: number, message: string) {
  const val = await readValue(ctx, contractId, address, address);
  if (val !== expected) throw new Error(`${message}: expected ${expected} got ${val}`);
}

function logMetadata(metadata: any, debug: boolean) {
  if (!debug || !metadata) return;
  console.log('[debug] Plugin metadata:');
  if (metadata.logs && metadata.logs.length > 0) {
    console.log('[debug]   Logs:');
    metadata.logs.forEach((log: string) => {
      console.log(`[debug]     ${log}`);
    });
  }
  if (metadata.traces && metadata.traces.length > 0) {
    console.log('[debug]   Traces:');
    metadata.traces.forEach((trace: any) => {
      console.log(`[debug]     ${JSON.stringify(trace, null, 2).split('\n').join('\n[debug]     ')}`);
    });
  }
}

async function callPluginExpectSuccess(ctx: Ctx, params: any, debug = false): Promise<any> {
  if (debug) {
    console.log('[debug] Calling plugin:');
    console.log(`[debug]   Endpoint: ${ctx.baseUrl}/api/v1/plugins/launchtube-plugin/call`);
    console.log(
      `[debug]   Params:`,
      Object.keys(params)
        .map((k) => `${k}=${typeof params[k]}`)
        .join(', '),
    );
    if (params.xdr) {
      console.log(`[debug]   XDR length: ${params.xdr.length} chars`);
    }
    if (params.func) {
      console.log(`[debug]   Func length: ${params.func.length} chars`);
    }
    if (params.auth) {
      console.log(`[debug]   Auth entries: ${params.auth.length}`);
    }
  }
  const res = await callPlugin(ctx, params);
  if (debug) {
    console.log('[debug] Plugin response received');
    if (res.metadata) {
      logMetadata(res.metadata, debug);
    }
  }
  const rv = unwrapReturnValue(res);
  if (rv?.error) throw new Error(rv.error);
  return rv;
}

async function expectPluginToReject(ctx: Ctx, params: any): Promise<void> {
  const res = await callPlugin(ctx, params);
  const rv = unwrapReturnValue(res);
  if (!rv?.error) throw new Error('Expected error but plugin succeeded');
}

async function signAndValidateAuth(ctx: Ctx, auth: string[], keypair: Keypair): Promise<string[]> {
  const decoded = auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'));
  if (decoded.some((e) => e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount())) {
    throw new Error('func+auth cannot use source-account credentials; set E2E_TX_SOURCE_NAME');
  }
  const latest = await ctx.rpc.getLatestLedger();
  const validUntil = Number(latest.sequence) + 64;
  const signed = await Promise.all(
    decoded.map((e) => authorizeEntry(e, keypair, validUntil, getNetworkPassphrase(ctx))),
  );
  return signed.map((e) => e.toXDR('base64'));
}

async function ensureRelayerHealthy(ctx: Ctx) {
  const healthUrl = `${ctx.baseUrl}/api/v1/health`;
  const headers: Record<string, string> = {};
  if (ctx.apiKey) headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  try {
    const res = await axios.get(healthUrl, { headers, timeout: 8000 });
    const ok =
      res.status === 200 &&
      (res.data === 'OK' || res.data?.status === 'ok' || res.data?.ok === true || res.data?.healthy === true);
    if (!ok) {
      throw new Error(`Unexpected health response. Status=${res.status} Body=${JSON.stringify(res.data)}`);
    }
  } catch (e: any) {
    console.error(`Failed to reach relayer at ${ctx.baseUrl}: ${e?.message || e}`);
    process.exit(1);
  }
}

async function ensureTxSourceAccount(ctx: Ctx, preferredName = '__e2e_txsrc'): Promise<string> {
  const name = process.env.E2E_TX_SOURCE_NAME || preferredName;
  if (!keyExists(name)) {
    console.log(`[info] Generating helper tx source key '${name}'`);
    sh(`stellar keys generate ${name}`);
  }
  const { address } = getKeypair(name);

  try {
    await ctx.rpc.getAccount(address);
  } catch {
    if (ctx.network === 'testnet') {
      try {
        await axios.get(`https://friendbot.stellar.org/?addr=${address}`, { timeout: 10000 });
        await new Promise((r) => setTimeout(r, 1500));
      } catch {
        /* friendbot failed, continue anyway */
      }
    }
  }
  return address;
}

async function isContractDeployed(ctx: Ctx, id: string, probeAddress: string): Promise<boolean> {
  try {
    await readValue(ctx, id, probeAddress, probeAddress);
    return true;
  } catch {
    return false;
  }
}

async function e2e() {
  const rawArgs = parseArgs(process.argv.slice(2));
  if (rawArgs['list']) {
    console.log('Available tests:');
    for (const t of TEST_CATALOG) console.log(`- ${t.id}  ${t.label}`);
    process.exit(0);
  }

  const cfg = getConfigFromEnvArgs();
  const ctx: Ctx = { ...cfg, rpc: new SorobanRpc.Server(cfg.rpcUrl) };

  if (!ctx.apiKey) {
    console.error('Missing API key. Pass --api-key or set API_KEY env.');
    process.exit(1);
  }

  await ensureRelayerHealthy(ctx);

  console.log(`Network: ${ctx.network} (${ctx.rpcUrl})`);

  if (!keyExists(ctx.accountName)) {
    console.error(`Key '${ctx.accountName}' not found. Create: stellar keys generate ${ctx.accountName}`);
    process.exit(1);
  }

  const { keypair, address } = getKeypair(ctx.accountName);
  const contractId = ctx.contractIdArg;

  if (!contractId) {
    console.error('No contract id provided. Pass --contract-id <ID>');
    process.exit(1);
  }

  if (!(await isContractDeployed(ctx, contractId, address))) {
    console.error(`Contract ${contractId} not found on ${ctx.network}`);
    process.exit(1);
  }

  const contract = buildClient(contractId);
  const env: TestEnv = { ctx, contractId, keypair, address, contract, debug: !!rawArgs['debug'] };

  const funcAuthTxSource = await ensureTxSourceAccount(ctx);
  if (env.debug) console.log(`[debug] func+auth tx source: ${funcAuthTxSource}`);

  const cases: TestCase[] = [
    {
      id: 'func-auth-sim',
      label: 'func+auth sim=true',
      run: async ({ ctx, contractId, address, contract, keypair, debug }) => {
        if (debug) console.log('[debug] Building transaction: write_with_address_auth(addr, 777)');
        const tx = await buildTxWithOps(ctx, funcAuthTxSource, [
          contract.call('write_with_address_auth', Address.fromString(address).toScVal(), xdr.ScVal.scvU32(777)),
        ]);
        if (debug) console.log(`[debug] TX source: ${funcAuthTxSource}, ops: 1`);

        if (debug) console.log('[debug] Simulating and assembling transaction');
        const assembled = await simulateAndAssemble(ctx, tx);
        const op = assembled.operations[0] as Operation.InvokeHostFunction;
        const func = op.func.toXDR('base64');
        const auth = (op.auth || []).map((a) => a.toXDR('base64'));

        if (debug) console.log('[debug] Signing and validating auth entries');
        const signedAuthB64 = await signAndValidateAuth(ctx, auth, keypair);

        await callPluginExpectSuccess(ctx, { func, auth: signedAuthB64, sim: true }, debug);
        await assertStoredValue(ctx, contractId, address, 777, 'unexpected stored value');
        console.log(`${PASS} func+auth sim=true`);
      },
    },
    {
      id: 'xdr-signed-nosim',
      label: 'xdr sim=false (pre‑assembled)',
      run: async ({ ctx, contractId, keypair, address, contract, debug }) => {
        if (debug) console.log('[debug] Building transaction: write_with_address_auth(addr, 778)');
        const tx = await buildTxWithOps(ctx, address, [
          contract.call('write_with_address_auth', Address.fromString(address).toScVal(), xdr.ScVal.scvU32(778)),
        ]);
        if (debug) console.log(`[debug] TX source: ${address}, ops: 1`);

        if (debug) console.log('[debug] Simulating and assembling transaction');
        const assembled = await simulateAndAssemble(ctx, tx);
        if (debug) console.log('[debug] Signing transaction with keypair');
        assembled.sign(keypair);
        await callPluginExpectSuccess(ctx, { xdr: assembled.toXDR(), sim: false }, debug);
        await assertStoredValue(ctx, contractId, address, 778, 'unexpected stored value');
        console.log(`${PASS} xdr sim=false (pre‑assembled)`);
      },
    },
    {
      id: 'xdr-sim-no-auth',
      label: 'xdr sim=true (no auth)',
      run: async ({ ctx, contract, debug }) => {
        if (debug) console.log('[debug] Building transaction: no_auth_bump(42)');
        const tx = await buildTxWithOps(ctx, funcAuthTxSource, [contract.call('no_auth_bump', xdr.ScVal.scvU32(42))]);
        if (debug) console.log(`[debug] TX source: ${funcAuthTxSource}, ops: 1`);
        await callPluginExpectSuccess(ctx, { xdr: tx.toXDR(), sim: true }, debug);
        console.log(`${PASS} xdr sim=true (no auth)`);
      },
    },
    {
      id: 'xdr-sim-source-auth',
      label: 'xdr sim=true with source-account auth (auto no-sim)',
      run: async ({ ctx, contractId, keypair, address, contract, debug }) => {
        if (debug) console.log('[debug] Building transaction: write_with_source_auth(addr, 880)');
        const tx = await buildTxWithOps(ctx, address, [
          contract.call('write_with_source_auth', Address.fromString(address).toScVal(), xdr.ScVal.scvU32(880)),
        ]);
        if (debug) console.log(`[debug] TX source: ${address}, ops: 1`);

        if (debug) console.log('[debug] Simulating and assembling transaction');
        const assembled = await simulateAndAssemble(ctx, tx);
        if (debug) console.log('[debug] Signing transaction with keypair');
        assembled.sign(keypair);
        await callPluginExpectSuccess(ctx, { xdr: assembled.toXDR(), sim: true }, debug);
        await assertStoredValue(ctx, contractId, address, 880, 'unexpected stored value');
        console.log(`${PASS} xdr sim=true with source-account auth (auto no-sim)`);
      },
    },
    {
      id: 'neg-func-auth-nosim',
      label: 'Negative: func+auth sim=false rejected',
      run: async ({ ctx, debug }) => {
        if (debug) console.log('[debug] Testing rejection: func+auth with sim=false');
        await expectPluginToReject(ctx, { func: 'AAAA', auth: [], sim: false });
        console.log(`${PASS} func+auth sim=false rejected`);
      },
    },
    {
      id: 'neg-xdr-two-ops',
      label: 'Negative: xdr with two ops rejected',
      run: async ({ ctx, address, contract, debug }) => {
        if (debug) console.log('[debug] Testing rejection: xdr with 2 operations');
        const tx = await buildTxWithOps(ctx, address, [
          contract.call('no_auth_bump', xdr.ScVal.scvU32(1)),
          contract.call('no_auth_bump', xdr.ScVal.scvU32(2)),
        ]);
        if (debug) console.log(`[debug] TX source: ${address}, ops: 2`);
        await expectPluginToReject(ctx, { xdr: tx.toXDR(), sim: false });
        console.log(`${PASS} xdr with two ops rejected`);
      },
    },
    {
      id: 'neg-xdr-far-timebounds',
      label: 'Negative: xdr sim=false with far timebounds rejected',
      run: async ({ ctx, keypair, address, contract, debug }) => {
        if (debug) console.log('[debug] Testing rejection: xdr with timeout=300s');
        const tx = await buildTxWithOps(ctx, address, [contract.call('no_auth_bump', xdr.ScVal.scvU32(3))], 300);
        if (debug) console.log(`[debug] TX source: ${address}, ops: 1, timeout: 300s`);
        const assembled = await simulateAndAssemble(ctx, tx);
        assembled.sign(keypair);
        await expectPluginToReject(ctx, { xdr: assembled.toXDR(), sim: false });
        console.log(`${PASS} xdr sim=false with far timebounds rejected`);
      },
    },
  ];

  const runArgs = parseArgs(process.argv.slice(2));
  let selected = cases;
  const onlyRaw = runArgs['only'];
  if (typeof onlyRaw === 'string' && onlyRaw.trim().length > 0) {
    const wanted = new Set(
      onlyRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    selected = cases.filter((t) => wanted.has(t.id));
    const missing = Array.from(wanted).filter((id) => !cases.some((t) => t.id === id));
    if (missing.length > 0) {
      console.error(`Unknown test id(s): ${missing.join(', ')}`);
      console.error('Use --list to see available tests.');
      process.exit(1);
    }
  } else if (onlyRaw === true) {
    console.error('Flag --only requires a value. Example: --only func-auth-sim');
    process.exit(1);
  }

  for (const tc of selected) {
    try {
      await tc.run(env);
    } catch (e) {
      console.error(`${FAIL} ${tc.label}`, e);
      throw e;
    }
  }

  console.log('\nAll E2E checks completed.');
}

e2e().catch((e) => {
  console.error(e);
  process.exit(1);
});
