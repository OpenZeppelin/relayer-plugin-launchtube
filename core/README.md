# @openzeppelin/relayer-plugins-core

Core library for building OpenZeppelin Relayer plugins.

## Installation

```bash
npm install @openzeppelin/relayer-plugins-core
# or
pnpm add @openzeppelin/relayer-plugins-core
```

## Usage

### Creating a Plugin

```typescript
import { PluginAPI, runPlugin } from '@openzeppelin/relayer-plugins-core';

interface MyPluginParams {
  destinationAddress: string;
  amount: number;
}

async function myPlugin(api: PluginAPI, params: MyPluginParams): Promise<string> {
  // Get a relayer instance
  const relayer = api.useRelayer('my-relayer-id');

  // Send a transaction
  const result = await relayer.sendTransaction({
    to: params.destinationAddress,
    value: params.amount,
    data: '0x',
    gas_limit: 21000,
  });

  // Wait for transaction to be mined
  await result.wait();

  return result.hash || 'Transaction sent';
}

// Run the plugin
runPlugin(myPlugin);
```

## API Reference

### `runPlugin(main: Plugin<T, R>)`

Entry point for plugin execution. Handles communication with the relayer, parameter parsing, and logging.

### `PluginAPI`

Main API class for interacting with the relayer.

#### Methods

- `useRelayer(relayerId: string): Relayer` - Creates a relayer instance for the given ID

### `Relayer`

Interface for relayer operations.

#### Methods

- `sendTransaction(payload: NetworkTransactionRequest): Promise<SendTransactionResult>`
- `getTransaction(payload: GetTransactionRequest): Promise<TransactionResponse>`
- `getRelayerStatus(): Promise<ApiResponseRelayerStatusData>`
- `getRelayer(): Promise<ApiResponseRelayerResponseData>`
- `signTransaction(payload: SignTransactionRequest): Promise<SignTransactionResponse>` (Stellar only)

### Logging

The plugin system automatically captures and formats console output:

```typescript
console.log('Info message'); // Captured as info log
console.error('Error message'); // Captured as error log
```

## Advanced Features

### Transaction Waiting

The `SendTransactionResult` includes a `wait()` method for monitoring transaction status:

```typescript
const result = await relayer.sendTransaction(payload);
const receipt = await result.wait({
  interval: 5000, // Poll every 5 seconds (default)
  timeout: 60000, // Timeout after 60 seconds (default)
});
```

### Error Handling

Plugins should handle errors gracefully. The plugin runner will capture and format errors automatically:

```typescript
async function myPlugin(api: PluginAPI, params: any): Promise<any> {
  try {
    // Plugin logic
  } catch (error) {
    console.error(`Plugin error: ${error.message}`);
    throw error; // Re-throw to signal failure
  }
}
```

## License

AGPL-3.0-or-later
