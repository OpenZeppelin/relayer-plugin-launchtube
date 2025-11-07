import { LaunchtubeClient } from '../src/client/launchtube-client';
import { PluginTransportError, PluginExecutionError, PluginUnexpectedError } from '../src/client/errors';
import axios from 'axios';
import { PluginsApi, Configuration } from '@openzeppelin/relayer-sdk';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock PluginsApi
jest.mock('@openzeppelin/relayer-sdk', () => ({
  Configuration: jest.fn(),
  PluginsApi: jest.fn(),
}));

describe('LaunchtubeClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration and Mode Detection', () => {
    test('should use HTTP mode when pluginId is not provided', () => {
      const mockAxiosInstance = {
        post: jest.fn(),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

      new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
      });

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://launchtube.example.com',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-key',
        },
      });
    });

    test('should use relayer mode when pluginId is provided', () => {
      const mockPluginsApi = {
        callPlugin: jest.fn(),
      };
      (PluginsApi as jest.Mock).mockImplementation(() => mockPluginsApi);

      new LaunchtubeClient({
        pluginId: 'test-plugin-id',
        apiKey: 'test-api-key',
        baseUrl: 'https://relayer.example.com',
      });

      expect(Configuration).toHaveBeenCalledWith({
        basePath: 'https://relayer.example.com',
        accessToken: 'test-api-key',
      });
      expect(PluginsApi).toHaveBeenCalled();
    });

    test('should throw error when baseUrl is missing in HTTP mode', () => {
      expect(() => {
        new LaunchtubeClient({
          apiKey: 'test-api-key',
        } as any);
      }).toThrow('baseUrl is required when pluginId is not provided (direct HTTP mode)');
    });

    test('should respect custom timeout', () => {
      const mockAxiosInstance = {
        post: jest.fn(),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

      new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
        timeout: 60000,
      });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60000,
        }),
      );
    });
  });

  describe('sendTransaction - HTTP Mode', () => {
    let client: LaunchtubeClient;
    let mockAxiosInstance: any;

    beforeEach(() => {
      mockAxiosInstance = {
        post: jest.fn(),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance);

      client = new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
      });
    });

    test('should send transaction successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: {
            transactionId: 'tx-123',
            hash: 'hash-abc',
            status: 'confirmed',
          },
        },
      });

      const result = await client.sendTransaction({
        xdr: 'AAAAAgAAAAC...',
        sim: true,
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/', {
        params: {
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        },
      });

      expect(result).toEqual({
        transactionId: 'tx-123',
        hash: 'hash-abc',
        status: 'confirmed',
      });
    });

    test('should include metadata in response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: {
            transactionId: 'tx-123',
            hash: 'hash-abc',
            status: 'confirmed',
          },
          metadata: {
            logs: [{ level: 'info', message: 'Transaction processed' }],
            traces: [{ action: 'simulate' }],
          },
        },
      });

      const result = await client.sendTransaction({
        xdr: 'AAAAAgAAAAC...',
        sim: true,
      });

      expect(result.metadata).toEqual({
        logs: [{ level: 'info', message: 'Transaction processed' }],
        traces: [{ action: 'simulate' }],
      });
    });

    test('should handle func+auth request', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: {
            transactionId: 'tx-456',
            hash: 'hash-def',
            status: 'confirmed',
          },
        },
      });

      await client.sendTransaction({
        func: 'BASE64FUNC',
        auth: ['AUTH1', 'AUTH2'],
        sim: false,
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/', {
        params: {
          func: 'BASE64FUNC',
          auth: ['AUTH1', 'AUTH2'],
          sim: false,
        },
      });
    });
  });

  describe('sendTransaction - Relayer Mode', () => {
    let client: LaunchtubeClient;
    let mockPluginsApi: any;

    beforeEach(() => {
      mockPluginsApi = {
        callPlugin: jest.fn(),
      };
      (PluginsApi as jest.Mock).mockImplementation(() => mockPluginsApi);

      client = new LaunchtubeClient({
        pluginId: 'test-plugin-id',
        apiKey: 'test-api-key',
        baseUrl: 'https://relayer.example.com',
      });
    });

    test('should send transaction successfully via relayer', async () => {
      mockPluginsApi.callPlugin.mockResolvedValue({
        data: {
          success: true,
          data: {
            transactionId: 'tx-789',
            hash: 'hash-ghi',
            status: 'confirmed',
          },
        },
      });

      const result = await client.sendTransaction({
        xdr: 'AAAAAgAAAAC...',
        sim: true,
      });

      expect(mockPluginsApi.callPlugin).toHaveBeenCalledWith('test-plugin-id', {
        params: {
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        },
      });

      expect(result).toEqual({
        transactionId: 'tx-789',
        hash: 'hash-ghi',
        status: 'confirmed',
      });
    });
  });

  describe('listSequenceAccounts', () => {
    let client: LaunchtubeClient;
    let mockAxiosInstance: any;

    beforeEach(() => {
      mockAxiosInstance = {
        post: jest.fn(),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance);

      client = new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
        adminSecret: 'admin-secret',
      });
    });

    test('should list sequence accounts successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: {
            relayerIds: ['relayer-1', 'relayer-2'],
          },
        },
      });

      const result = await client.listSequenceAccounts();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/', {
        params: {
          management: {
            action: 'listSequenceAccounts',
            adminSecret: 'admin-secret',
          },
        },
      });

      expect(result).toEqual({
        relayerIds: ['relayer-1', 'relayer-2'],
      });
    });

    test('should throw error when adminSecret is not provided', async () => {
      const clientWithoutSecret = new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
      });

      await expect(clientWithoutSecret.listSequenceAccounts()).rejects.toThrow(
        'adminSecret required for management operations',
      );
    });
  });

  describe('setSequenceAccounts', () => {
    let client: LaunchtubeClient;
    let mockAxiosInstance: any;

    beforeEach(() => {
      mockAxiosInstance = {
        post: jest.fn(),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance);

      client = new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
        adminSecret: 'admin-secret',
      });
    });

    test('should set sequence accounts successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: true,
          data: {
            ok: true,
            appliedRelayerIds: ['relayer-1', 'relayer-2'],
          },
        },
      });

      const result = await client.setSequenceAccounts(['relayer-1', 'relayer-2']);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/', {
        params: {
          management: {
            action: 'setSequenceAccounts',
            adminSecret: 'admin-secret',
            relayerIds: ['relayer-1', 'relayer-2'],
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        appliedRelayerIds: ['relayer-1', 'relayer-2'],
      });
    });

    test('should throw error when adminSecret is not provided', async () => {
      const clientWithoutSecret = new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
      });

      await expect(clientWithoutSecret.setSequenceAccounts(['relayer-1'])).rejects.toThrow(
        'adminSecret required for management operations',
      );
    });
  });

  describe('Error Handling', () => {
    let client: LaunchtubeClient;
    let mockAxiosInstance: any;

    beforeEach(() => {
      mockAxiosInstance = {
        post: jest.fn(),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance);

      client = new LaunchtubeClient({
        baseUrl: 'https://launchtube.example.com',
        apiKey: 'test-api-key',
      });
    });

    test('should throw PluginExecutionError when plugin returns error', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          success: false,
          error: 'Invalid transaction',
          data: { code: 'INVALID_TX' },
        },
      });

      await expect(
        client.sendTransaction({
          xdr: 'INVALID',
          sim: true,
        }),
      ).rejects.toThrow(PluginExecutionError);

      try {
        await client.sendTransaction({
          xdr: 'INVALID',
          sim: true,
        });
      } catch (error: any) {
        expect(error.message).toBe('Invalid transaction');
        expect(error.category).toBe('execution');
        expect(error.errorDetails).toEqual({ code: 'INVALID_TX' });
      }
    });

    test('should throw PluginTransportError on network error', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Network Error',
        response: {
          status: 503,
        },
      };
      (mockedAxios.isAxiosError as any) = jest.fn().mockReturnValue(true);
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(
        client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        }),
      ).rejects.toThrow(PluginTransportError);

      try {
        await client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        });
      } catch (error: any) {
        expect(error.category).toBe('transport');
        expect(error.statusCode).toBe(503);
      }
    });

    test('should throw PluginTransportError on axios error with response data', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 500,
          data: {
            success: false,
            error: 'Internal server error',
          },
        },
      };
      (mockedAxios.isAxiosError as any) = jest.fn().mockReturnValue(true);
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(
        client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        }),
      ).rejects.toThrow(PluginExecutionError);
    });

    test('should throw PluginUnexpectedError on empty response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: null,
      });

      await expect(
        client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        }),
      ).rejects.toThrow(PluginUnexpectedError);

      try {
        await client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        });
      } catch (error: any) {
        expect(error.message).toBe('Empty or invalid response from plugin');
        expect(error.category).toBe('client');
      }
    });

    test('should throw PluginUnexpectedError on malformed response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          // Missing success field
          data: { foo: 'bar' },
        },
      });

      await expect(
        client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        }),
      ).rejects.toThrow(PluginUnexpectedError);

      try {
        await client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        });
      } catch (error: any) {
        expect(error.message).toBe('Malformed response: missing success field');
        expect(error.category).toBe('client');
      }
    });

    test('should throw PluginUnexpectedError on non-axios error', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Something went wrong'));
      (mockedAxios.isAxiosError as any) = jest.fn().mockReturnValue(false);

      await expect(
        client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        }),
      ).rejects.toThrow(PluginUnexpectedError);

      try {
        await client.sendTransaction({
          xdr: 'AAAAAgAAAAC...',
          sim: true,
        });
      } catch (error: any) {
        expect(error.message).toContain('Unexpected error');
        expect(error.category).toBe('client');
      }
    });
  });
});
