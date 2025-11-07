# Launchtube Plugin

A plugin for OpenZeppelin Relayer that simplifies submitting Stellar Soroban transactions by handling fees, sequence numbers, and retries.

This package provides:

- **Plugin**: A handler for OpenZeppelin Relayer that processes Soroban transactions
- **Client**: A TypeScript/JavaScript client library for easy integration in applications

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Client Usage](#client-usage)
  - [Installing the Client](#installing-the-client)
  - [Client Modes](#client-modes)
  - [Sending Transactions](#sending-transactions)
  - [Managing Sequence Accounts](#managing-sequence-accounts)
  - [Error Handling](#error-handling)
  - [TypeScript Types](#typescript-types)
- [Direct HTTP API Usage](#direct-http-api-usage)
- [Configuration](#configuration)
- [Management API](#management-api)
- [Development](#development)
- [How It Works](#how-it-works)

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
- The management API will prevent removing accounts that are currently locked (in use). On failure it throws a plugin error with status 409, code `LOCKED_CONFLICT`, and `details.locked` listing blocked IDs.
- All relayer IDs must exist in your OpenZeppelin Relayer configuration
- The `adminSecret` must match the `LAUNCHTUBE_ADMIN_SECRET` environment variable

## Direct HTTP API Usage

These examples show how to interact with the plugin using direct HTTP requests (e.g., with curl). For a better developer experience in TypeScript/JavaScript applications, see the [Client Usage](#client-usage) section.

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

Responses follow the Relayer envelope `{ success, data, error }`.

Success example:

```json
{
  "success": true,
  "data": {
    "result": {
      "transactionId": "tx_123456",
      "hash": "1234567890abcdef..."
    }
  },
  "error": null
}
```

Plugin error example:

```json
{
  "success": false,
  "data": {
    "code": "INVALID_PARAMS",
    "details": { "sim": false, "xdrProvided": false }
  },
  "error": "Cannot pass `sim = false` without `xdr`"
}
```

## How It Works

1. **Request Validation**: Validates input parameters and extracts Soroban data
2. **Sequence Account Pool**: Acquires an available sequence account
3. **Auth Checking**: Validates authorization entries
4. **Simulation** (if enabled): Simulates transaction and rebuilds with proper resources
5. **Fee Bumping**: Fund account wraps transaction with fee bump
6. **Submission**: Sends to Stellar network

## Client Usage

The Launchtube package includes a TypeScript/JavaScript client that provides a clean, type-safe interface for interacting with the plugin. The client automatically handles request formatting, response parsing, and error handling.

### Installing the Client

```bash
npm install @openzeppelin/relayer-plugin-launchtube
# or
pnpm add @openzeppelin/relayer-plugin-launchtube
```

### Client Modes

The client supports two modes and automatically detects which to use based on configuration:

#### Relayer Mode

Use when the Launchtube plugin is deployed in an OpenZeppelin Relayer:

```typescript
import { LaunchtubeClient } from '@openzeppelin/relayer-plugin-launchtube';

const client = new LaunchtubeClient({
  pluginId: 'launchtube-plugin-id',
  apiKey: 'relayer-api-key',
  baseUrl: 'https://api.defender.openzeppelin.com',
  adminSecret: 'your-admin-secret', // optional, required for management operations
});
```

#### Direct HTTP Mode

Use when the Launchtube plugin is exposed via direct HTTP:

```typescript
import { LaunchtubeClient } from '@openzeppelin/relayer-plugin-launchtube';

const client = new LaunchtubeClient({
  baseUrl: 'https://launchtube.example.com',
  apiKey: 'your-api-key',
  adminSecret: 'your-admin-secret', // optional, required for management operations
  timeout: 30000, // optional, default: 30000ms
});
```

### Sending Transactions

#### With Complete Transaction XDR

```typescript
try {
  const result = await client.sendTransaction({
    xdr: 'AAAAAgAAAAA...',
    sim: false, // set to true to simulate before submission
  });

  console.log('Transaction submitted:', result.transactionId);
  console.log('Hash:', result.hash);
  console.log('Status:', result.status);
} catch (error) {
  if (error instanceof PluginExecutionError) {
    console.error('Plugin rejected:', error.message);
    console.error('Details:', error.errorDetails);
  } else if (error instanceof PluginTransportError) {
    console.error('Network error:', error.message);
  }
}
```

#### With Function and Auth

```typescript
import { LaunchtubeClient, PluginExecutionError, PluginTransportError } from '@openzeppelin/relayer-plugin-launchtube';

const result = await client.sendTransaction({
  func: 'AAAABAAAAAEAAAAGc3ltYm9s...',
  auth: ['AAAACAAAAAEAAAA...', 'AAAACAAAAAEAAAA...'],
  sim: true, // simulation required when using func+auth
});
```

### Managing Sequence Accounts

The client provides methods for dynamically managing sequence accounts. These operations require `adminSecret` to be configured.

#### List Sequence Accounts

```typescript
try {
  const accounts = await client.listSequenceAccounts();
  console.log('Configured accounts:', accounts.relayerIds);
} catch (error) {
  if (error instanceof PluginExecutionError) {
    console.error('Unauthorized:', error.message);
  }
}
```

#### Set Sequence Accounts

```typescript
try {
  const result = await client.setSequenceAccounts(['launchtube-seq-001', 'launchtube-seq-002', 'launchtube-seq-003']);

  console.log('Success:', result.ok);
  console.log('Applied:', result.appliedRelayerIds);
} catch (error) {
  if (error instanceof PluginExecutionError) {
    // Check for locked accounts conflict
    if (error.errorDetails?.code === 'LOCKED_CONFLICT') {
      console.error('Cannot remove locked accounts:', error.errorDetails.details.locked);
    }
  }
}
```

### Error Handling

The client throws typed errors for different failure scenarios:

```typescript
import {
  LaunchtubeClient,
  PluginClientError,
  PluginTransportError,
  PluginExecutionError,
  PluginUnexpectedError,
} from '@openzeppelin/relayer-plugin-launchtube';

try {
  const result = await client.sendTransaction({ xdr: '...', sim: false });
} catch (error) {
  if (error instanceof PluginTransportError) {
    // Network/HTTP failures (connection refused, timeouts, 5xx errors)
    console.error('Transport error:', error.message);
    console.error('Status code:', error.statusCode);
  } else if (error instanceof PluginExecutionError) {
    // Plugin-side validation or business logic errors
    console.error('Execution error:', error.message);
    console.error('Error details:', error.errorDetails);
  } else if (error instanceof PluginUnexpectedError) {
    // Malformed responses or unexpected client-side errors
    console.error('Unexpected error:', error.message);
  } else if (error instanceof Error) {
    // Configuration errors (e.g., missing adminSecret)
    console.error('Configuration error:', error.message);
  }
}
```

### TypeScript Types

The client is fully typed for TypeScript projects:

```typescript
import type {
  LaunchtubeClientConfig,
  DirectHttpConfig,
  RelayerConfig,
  LaunchtubeTransactionRequest,
  LaunchtubeTransactionResponse,
  ListSequenceAccountsResponse,
  SetSequenceAccountsResponse,
} from '@openzeppelin/relayer-plugin-launchtube';

// Type-safe configuration
const config: RelayerConfig = {
  pluginId: 'my-plugin-id',
  apiKey: 'my-api-key',
  baseUrl: 'https://api.defender.openzeppelin.com',
};

const client = new LaunchtubeClient(config);
```

## License

MIT License
