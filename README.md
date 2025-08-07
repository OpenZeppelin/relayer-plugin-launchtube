# Launchtube Plugin

A plugin for OpenZeppelin Relayer that simplifies submitting Stellar Soroban transactions by handling fees, sequence numbers, and retries.

## Prerequisites

- Node.js >= 18
- pnpm >= 10
- OpenZeppelin Relayer

## Installation & Setup

LaunchTube can be added to any OpenZeppelin Relayer in two ways:

### 1. Install from npm (recommended)

```bash
# From the root of your Relayer repository
cd plugins
pnpm add @openzeppelin/relayer-plugin-launchtube
```

### 2. Use a local build (for development / debugging)

```bash
# Clone and build the plugin
git clone https://github.com/openzeppelin/relayer-plugin-launchtube.git
cd relayer-plugin-launchtube
pnpm install
pnpm build
```

Now reference the local build from your Relayer’s `plugins/package.json`:

```jsonc
{
  "dependencies": {
    "@openzeppelin/relayer-plugin-launchtube": "file:../../relayer-plugin-launchtube",
  },
}
```

Install dependencies:

```bash
pnpm install
```

---

### Create the plugin wrapper

Inside the Relayer create a directory for the plugin and expose its handler:

```bash
mkdir -p plugins/launchtube
```

`plugins/launchtube/index.ts`

```ts
export { handler } from '@openzeppelin/relayer-plugin-launchtube';
```

### Provide a configuration file

Copy the bundled example and tweak it to your needs:

```bash
cp node_modules/@openzeppelin/relayer-plugin-launchtube/config.example.json plugins/launchtube/config.json
```

Edit `plugins/launchtube/config.json` (see Configuration section).

Your Relayer should now contain:

```
relayer/
└─ plugins/
   ├─ package.json              # lists the dependency
   └─ launchtube/
      ├─ index.ts
      └─ config.json
```

LaunchTube is now ready to serve Soroban transactions 🚀

## Development

### Building from Source

```Shell
# Install dependencies
pnpm install

# Build the plugin
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm lint
pnpm format
```

## Overview

Launchtube accepts Soroban operations and handles all the complexity of getting them on-chain:

- Automatic fee bumping using a dedicated fund account
- Sequence number management with a pool of sequence accounts
- Transaction simulation and rebuilding
- Retry logic and error handling

## Configuration

Create `config.json` in the plugin directory:

```JSON
{
  "fundRelayerId": "launchtube-fund",
  "sequenceRelayerIds": ["launchtube-seq-001", "launchtube-seq-002"],
  "maxFee": 1000000,
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org"
}
```

**Configuration Options:**

- `fundRelayerId`: Relayer ID for the account that pays fees
- `sequenceRelayerIds`: Array of relayer IDs for sequence accounts
- `maxFee`: Maximum fee in stroops (1 XLM = 10,000,000 stroops)
- `network`: Either "testnet" or "mainnet"
- `rpcUrl`: Stellar Soroban RPC endpoint

## API Usage

### Submit with Transaction XDR

Submit a complete, signed transaction:

```Shell
curl -X POST http://localhost:8080/api/v1/plugins/launchtube/call \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "xdr": "AAAAAgAAAAA...",
      "sim": false
    }
  }'
```

### Submit with Function and Auth

Submit just the Soroban function and auth entries:

```Shell
curl -X POST http://localhost:8080/api/v1/plugins/launchtube/call \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "func": "AAAABAAAAAEAAAAGc3ltYm9s...",
      "auth": ["AAAACAAAAAEAAAA..."],
      "sim": true
    }
  }'
```

### Parameters

- `xdr` (string): Complete transaction envelope XDR
- `func` (string): Soroban host function XDR
- `auth` (array): Array of Soroban authorization entry XDRs
- `sim` (boolean): Whether to simulate the transaction before submission

**Note**: Provide either `xdr` OR `func`+`auth`, not both.

### Response

```JSON
{
  "transactionId": "tx_123456",
  "status": "submitted",
  "hash": "1234567890abcdef..."
}
```

## How It Works

1. **Request Validation**: Validates input parameters and extracts Soroban data
2. **Sequence Account Pool**: Acquires an available sequence account
3. **Auth Checking**: Validates authorization entries
4. **Simulation** (if enabled): Simulates transaction and rebuilds with proper resources
5. **Fee Bumping**: Fund account wraps transaction with fee bump
6. **Submission**: Sends to Stellar network

## License

MIT License
