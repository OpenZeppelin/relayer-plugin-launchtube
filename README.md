# Launchtube Plugin

A plugin for OpenZeppelin Relayer that simplifies submitting Stellar Soroban transactions by handling fees, sequence numbers, and retries.

## Repository Structure

```
src/                               # Stellar Soroban plugin source code
```

## Prerequisites

- Node.js >= 18
- pnpm >= 10

## Development

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Scripts

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm lint
pnpm format
```

## Creating a Plugin

To create a plugin for OpenZeppelin Relayer, write a TypeScript function that follows the plugin structure and declare it in your configuration file. For detailed information about writing plugins, see the [OpenZeppelin Relayer Plugins documentation](https://docs.openzeppelin.com/relayer/1.0.x/plugins).


## Overview

Launchtube accepts Soroban operations and handles all the complexity of getting them on-chain:
- Automatic fee bumping using a dedicated fund account
- Sequence number management with a pool of sequence accounts
- Transaction simulation and rebuilding
- Retry logic and error handling

## Configuration

Create `config.json` in the plugin directory:

```json
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

```bash
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

```bash
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

```json
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

## Error Handling

Common errors:
- `No sequence accounts available`: All sequence accounts are in use
- `sorobanCredentialsSourceAccount is invalid`: Cannot use sequence account in auth
- `Transaction fee must be equal to the resource fee`: Fee doesn't match simulation
- `Simulation failed`: Transaction would fail on-chain

## License

MIT License