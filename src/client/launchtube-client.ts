import axios, { AxiosInstance } from 'axios';
import { Configuration, PluginsApi } from '@openzeppelin/relayer-sdk';
import type { LogEntry } from '@openzeppelin/relayer-sdk';
import { PluginTransportError, PluginExecutionError, PluginUnexpectedError } from './errors';
import type {
  LaunchtubeClientConfig,
  LaunchtubeTransactionRequest,
  LaunchtubeTransactionResponse,
  ListSequenceAccountsResponse,
  SetSequenceAccountsResponse,
  PluginResponse,
} from './types';

/**
 * Unified Launchtube client that supports both direct HTTP and OpenZeppelin Relayer modes
 *
 * The client automatically detects the mode based on configuration:
 * - If `pluginId` is provided → routes through OpenZeppelin Relayer
 * - Otherwise → connects directly via HTTP
 *
 * @example
 * // Direct HTTP mode
 * const client = new LaunchtubeClient({
 *   baseUrl: 'https://launchtube.example.com',
 *   apiKey: 'your-api-key',
 *   adminSecret: 'your-admin-secret',
 * });
 *
 * @example
 * // Relayer mode
 * const client = new LaunchtubeClient({
 *   baseUrl: 'https://relayer.example.com',
 *   pluginId: 'launchtube-plugin-id',
 *   apiKey: 'relayer-api-key',
 *   adminSecret: 'your-admin-secret',
 * });
 */
export class LaunchtubeClient {
  private readonly mode: 'http' | 'relayer';
  private readonly adminSecret?: string;
  private readonly axiosClient?: AxiosInstance;
  private readonly pluginsApi?: PluginsApi;
  private readonly pluginId?: string;

  constructor(config: LaunchtubeClientConfig) {
    this.adminSecret = config.adminSecret;

    // Auto-detect mode based on presence of pluginId
    if ('pluginId' in config && config.pluginId) {
      // Relayer mode
      this.mode = 'relayer';
      this.pluginId = config.pluginId;

      const relayerConfig = new Configuration({
        basePath: config.baseUrl,
        accessToken: config.apiKey,
      });

      this.pluginsApi = new PluginsApi(relayerConfig);
    } else {
      // Direct HTTP mode
      this.mode = 'http';

      if (!('baseUrl' in config) || !config.baseUrl) {
        throw new Error('baseUrl is required when pluginId is not provided (direct HTTP mode)');
      }

      this.axiosClient = axios.create({
        baseURL: config.baseUrl,
        timeout: config.timeout || 30000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });
    }
  }

  /**
   * Send a transaction to the Launchtube service
   *
   * @param request Transaction request (xdr OR func+auth, plus sim flag)
   * @returns Transaction result with ID, hash, and status
   * @throws {PluginTransportError} Network/HTTP failures
   * @throws {PluginExecutionError} Plugin rejected the request
   * @throws {PluginUnexpectedError} Malformed response or client-side errors
   *
   * @example
   * const result = await client.sendTransaction({
   *   xdr: 'AAAAAgAAAAC...',
   *   sim: true,
   * });
   */
  async sendTransaction(request: LaunchtubeTransactionRequest): Promise<LaunchtubeTransactionResponse> {
    return this.call<LaunchtubeTransactionResponse>(request);
  }

  /**
   * List currently configured sequence accounts (requires adminSecret)
   *
   * @returns List of sequence account relayer IDs
   * @throws {Error} If adminSecret not provided in config
   * @throws {PluginTransportError} Network/HTTP failures
   * @throws {PluginExecutionError} Plugin rejected the request
   * @throws {PluginUnexpectedError} Malformed response or client-side errors
   *
   * @example
   * const accounts = await client.listSequenceAccounts();
   * console.log(accounts.relayerIds);
   */
  async listSequenceAccounts(): Promise<ListSequenceAccountsResponse> {
    return this.call<ListSequenceAccountsResponse>({
      management: {
        action: 'listSequenceAccounts',
        adminSecret: this.requireAdminSecret(),
      },
    });
  }

  /**
   * Configure sequence accounts for the Launchtube service (requires adminSecret)
   *
   * @param relayerIds Array of relayer IDs to use as sequence accounts
   * @returns Confirmation with applied relayer IDs
   * @throws {Error} If adminSecret not provided in config
   * @throws {PluginTransportError} Network/HTTP failures
   * @throws {PluginExecutionError} Plugin rejected the request
   * @throws {PluginUnexpectedError} Malformed response or client-side errors
   *
   * @example
   * const result = await client.setSequenceAccounts([
   *   'relayer-id-1',
   *   'relayer-id-2',
   * ]);
   */
  async setSequenceAccounts(relayerIds: string[]): Promise<SetSequenceAccountsResponse> {
    return this.call<SetSequenceAccountsResponse>({
      management: {
        action: 'setSequenceAccounts',
        adminSecret: this.requireAdminSecret(),
        relayerIds,
      },
    });
  }

  /**
   * Ensures adminSecret is configured
   *
   * @returns The admin secret value
   * @throws {Error} If adminSecret not provided in config
   */
  private requireAdminSecret(): string {
    if (!this.adminSecret) {
      throw new Error('adminSecret required for management operations. Provide it in client config.');
    }
    return this.adminSecret;
  }

  /**
   * Parses axios errors and extracts response body if available
   *
   * @param error The caught error from axios
   * @returns Plugin response if available in error
   * @throws {PluginTransportError} For network/transport errors
   * @throws {PluginUnexpectedError} For unknown error types
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseAxiosError(error: unknown): PluginResponse<any> | never {
    if (axios.isAxiosError(error)) {
      if (error.response?.data) {
        // HTTP error with response body - return it for further processing
        return error.response.data;
      }
      // Network/transport error without response body
      throw new PluginTransportError(`Network error: ${error.message}`, error.response?.status, error);
    }
    // Unknown error type
    throw new PluginUnexpectedError(
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }

  /**
   * Validates that response has the expected plugin response structure
   *
   * @param responseBody The raw response body to validate
   * @returns Validated plugin response
   * @throws {PluginUnexpectedError} For invalid/malformed responses
   */
  private validateResponse<T>(responseBody: unknown): PluginResponse<T> {
    if (!responseBody || typeof responseBody !== 'object') {
      throw new PluginUnexpectedError('Empty or invalid response from plugin');
    }

    const response = responseBody as PluginResponse<T>;

    if (response.success === undefined) {
      throw new PluginUnexpectedError('Malformed response: missing success field');
    }

    return response;
  }

  /**
   * Merges metadata into the response data if present
   *
   * @param data The response data
   * @param metadata Optional metadata (logs and traces)
   * @returns Data with metadata merged if present
   */
  private mergeMetadata<T>(
    data: T,
    metadata?: { logs?: LogEntry[]; traces?: any[] }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): T {
    if (!metadata || (!metadata.logs && !metadata.traces)) {
      return data;
    }
    return { ...data, metadata } as T;
  }

  /**
   * Internal method to make a plugin call with automatic payload wrapping and response parsing
   *
   * @param params Request parameters
   * @returns Parsed response data with optional metadata
   * @throws {PluginTransportError} Network/HTTP failures
   * @throws {PluginExecutionError} Plugin rejected the request
   * @throws {PluginUnexpectedError} Malformed response or client-side errors
   */
  private async call<T>(params: unknown): Promise<T> {
    const payload = { params };

    // Send request and handle transport errors
    let responseBody: unknown;
    try {
      responseBody = await this.sendCall(payload);
    } catch (error) {
      responseBody = this.parseAxiosError(error);
    }

    // Validate response structure
    const response = this.validateResponse<T>(responseBody);

    // Handle execution errors
    if (!response.success) {
      throw new PluginExecutionError(response.error || 'Plugin execution failed', response.data);
    }

    // Return data with metadata if present
    return this.mergeMetadata(response.data, response.metadata);
  }

  /**
   * Internal method to send the actual HTTP request
   * Routes to either axios (direct HTTP) or PluginsApi (relayer) based on mode
   *
   * @param payload The complete payload (already wrapped in {params})
   * @returns Raw response from the service/relayer
   */
  private async sendCall(payload: { params: unknown }): Promise<unknown> {
    if (this.mode === 'http') {
      const response = await this.axiosClient!.post('/', payload);
      return response.data;
    }

    const response = await this.pluginsApi!.callPlugin(this.pluginId!, payload);
    return response.data;
  }
}
