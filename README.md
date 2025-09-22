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

### Configure Environment Variables

Set the required environment variables for the plugin:

```bash
# Required environment variables
export STELLAR_NETWORK="testnet"        # or "mainnet"
export SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
export FUND_RELAYER_ID="launchtube-fund"
export LAUNCHTUBE_ADMIN_SECRET="your-secret-here"  # Required for management API
export LOCK_TTL_SECONDS=30
```

Your Relayer should now contain:

```
relayer/
└─ plugins/
   ├─ package.json              # lists the dependency
   └─ launchtube/
      └─ index.ts
```

### Initialize Sequence Accounts

Before using LaunchTube, you must configure sequence accounts using the management API:

```bash
curl -X POST http://localhost:8080/api/v1/plugins/launchtube/call \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "management": {
        "action": "setSequenceAccounts",
        "adminSecret": "your-secret-here",
        "relayerIds": ["launchtube-seq-001", "launchtube-seq-002"]
      }
    }
  }'
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

LaunchTube is configured through environment variables:

**Required Environment Variables:**

- `STELLAR_NETWORK`: Either "testnet" or "mainnet"
- `SOROBAN_RPC_URL`: Stellar Soroban RPC endpoint
- `FUND_RELAYER_ID`: Relayer ID for the account that pays fees

**Optional Environment Variables:**

- `LAUNCHTUBE_ADMIN_SECRET`: Secret for accessing the management API (required to manage sequence accounts)
- `LOCK_TTL_SECONDS`: TTL for sequence account locks (default: 30, range: 10-30)

**Note:** Sequence accounts are no longer configured via config file. They must be managed dynamically through the Management API (see below).

## Management API

LaunchTube provides a management API to dynamically configure sequence accounts. This API requires authentication via the `LAUNCHTUBE_ADMIN_SECRET` environment variable.

### List Sequence Accounts

Get the current list of configured sequence accounts:

```Shell
curl -X POST http://localhost:8080/api/v1/plugins/launchtube/call \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "management": {
        "action": "listSequenceAccounts",
        "adminSecret": "your-secret-here"
      }
    }
  }'
```

**Response:**

```JSON
{
  "relayerIds": ["launchtube-seq-001", "launchtube-seq-002"]
}
```

### Set Sequence Accounts

Configure the sequence accounts that LaunchTube will use. This replaces the entire list:

```Shell
curl -X POST http://localhost:8080/api/v1/plugins/launchtube/call \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "management": {
        "action": "setSequenceAccounts",
        "adminSecret": "your-secret-here",
        "relayerIds": ["launchtube-seq-001", "launchtube-seq-002", "launchtube-seq-003"]
      }
    }
  }'
```

**Response:**

```JSON
{
  "ok": true,
  "appliedRelayerIds": ["launchtube-seq-001", "launchtube-seq-002", "launchtube-seq-003"]
}
```

**Important Notes:**

- You must configure at least one sequence account before LaunchTube can process transactions
- The management API will prevent removing accounts that are currently locked (in use)
- All relayer IDs must exist in your OpenZeppelin Relayer configuration
- The `adminSecret` must match the `LAUNCHTUBE_ADMIN_SECRET` environment variable

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
