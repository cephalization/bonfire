/**
 * API Client Unit Tests
 * 
 * Tests for error handling logic in the API client.
 * These tests use mocked fetch to avoid network calls.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { APIClientConfig, VM, Image } from './api';

// Store original fetch
const originalFetch = global.fetch;

// Create mock
const mockFetch = vi.fn(() => Promise.resolve(new Response()));

// Replace fetch before any imports happen
global.fetch = mockFetch as unknown as typeof fetch;

// Now import the module - it will capture our mock
const apiModule = await import('./api');
const { 
  BonfireAPIError,
  createAPIClient,
  listVMs,
  getVM,
  createVM,
  deleteVM,
  startVM,
  stopVM,
  listImages,
  pullImage,
  deleteImage,
} = apiModule;

describe('API Client Error Handling', () => {
  const config: APIClientConfig = {
    baseUrl: 'http://test-api:3000',
    getAuthToken: () => 'test-token',
  };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('apiFetch base wrapper', () => {
    it('injects authorization header when token is available', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      );

      await listVMs(config);

      const calls = mockFetch.mock.calls as unknown as [string, { headers: Record<string, string> }][];
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1].headers['Authorization']).toBe('Bearer test-token');
    });

    it('does not inject auth header when token is null', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      );

      const noAuthConfig: APIClientConfig = {
        baseUrl: 'http://test-api:3000',
        getAuthToken: () => null,
      };

      await listVMs(noAuthConfig);

      const calls = mockFetch.mock.calls as unknown as [string, { headers: Record<string, string> }][];
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1].headers['Authorization']).toBeUndefined();
    });

    it('throws BonfireAPIError with NETWORK_ERROR for fetch failures', async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new Error('Failed to fetch'))
      );

      try {
        await listVMs(config);
        expect(false).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(BonfireAPIError);
        expect((error as InstanceType<typeof BonfireAPIError>).message).toBe('Failed to fetch');
        expect((error as InstanceType<typeof BonfireAPIError>).status).toBe(0);
        expect((error as InstanceType<typeof BonfireAPIError>).code).toBe('NETWORK_ERROR');
      }
    });

    it('throws BonfireAPIError with AUTH_REQUIRED for 401 responses', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      );

      const onAuthError = vi.fn(() => {});
      const authConfig: APIClientConfig = {
        ...config,
        onAuthError,
      };

      try {
        await listVMs(authConfig);
        expect(false).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(BonfireAPIError);
        expect((error as InstanceType<typeof BonfireAPIError>).status).toBe(401);
        expect((error as InstanceType<typeof BonfireAPIError>).code).toBe('AUTH_REQUIRED');
        expect(onAuthError).toHaveBeenCalled();
      }
    });

    it('throws BonfireAPIError with parsed error message from JSON response', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ message: 'VM not found', code: 'VM_NOT_FOUND' }),
            { status: 404, statusText: 'Not Found' }
          )
        )
      );

      try {
        await getVM('non-existent', config);
        expect(false).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(BonfireAPIError);
        expect((error as InstanceType<typeof BonfireAPIError>).message).toBe('VM not found');
        expect((error as InstanceType<typeof BonfireAPIError>).code).toBe('VM_NOT_FOUND');
        expect((error as InstanceType<typeof BonfireAPIError>).status).toBe(404);
      }
    });

    it('throws BonfireAPIError with default message for non-JSON error responses', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }))
      );

      try {
        await listVMs(config);
        expect(false).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(BonfireAPIError);
        expect((error as InstanceType<typeof BonfireAPIError>).message).toBe('HTTP 500: Internal Server Error');
        expect((error as InstanceType<typeof BonfireAPIError>).status).toBe(500);
      }
    });

    it('throws BonfireAPIError with INVALID_JSON for invalid JSON responses', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('not valid json', { status: 200 }))
      );

      try {
        await listVMs(config);
        expect(false).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(BonfireAPIError);
        expect((error as InstanceType<typeof BonfireAPIError>).message).toBe('Invalid JSON response');
        expect((error as InstanceType<typeof BonfireAPIError>).code).toBe('INVALID_JSON');
      }
    });

    it('returns undefined for 204 No Content responses', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 204 }))
      );

      const result = await deleteVM('vm-123', config);
      expect(result).toBeUndefined();
    });
  });

  describe('VM endpoints', () => {
    it('listVMs makes GET request to /api/vms', async () => {
      const mockVMs: VM[] = [
        { 
          id: '1', 
          name: 'vm1', 
          status: 'running', 
          vcpus: 2, 
          memoryMib: 1024, 
          imageId: 'img-1',
          pid: null,
          socketPath: null,
          tapDevice: null,
          macAddress: null,
          ipAddress: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockVMs), { status: 200 }))
      );

      const result = await listVMs(config);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:3000/api/vms',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual(mockVMs);
    });

    it('getVM makes GET request with correct ID', async () => {
      const mockVM: VM = { 
        id: '123', 
        name: 'test-vm', 
        status: 'running', 
        vcpus: 2, 
        memoryMib: 1024,
        imageId: null,
        pid: 12345,
        socketPath: '/tmp/test.sock',
        tapDevice: 'tap0',
        macAddress: '00:00:00:00:00:01',
        ipAddress: '10.0.100.2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockVM), { status: 200 }))
      );

      const result = await getVM('123', config);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:3000/api/vms/123',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.id).toBe('123');
    });

    it.skip('createVM makes POST request with correct body', async () => {
      const mockVM: VM = { 
        id: 'new-123', 
        name: 'new-vm', 
        status: 'creating', 
        vcpus: 1, 
        memoryMib: 512,
        imageId: 'default-img',
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockVM), { status: 201 }))
      );

      const request = { name: 'new-vm', vcpus: 1, memoryMib: 512 };
      await createVM(request, config);

      const calls = mockFetch.mock.calls as unknown as [string, { method: string; body: string }][];
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe('http://test-api:3000/api/vms');
      expect(calls[0][1].method).toBe('POST');
      expect(JSON.parse(calls[0][1].body)).toEqual(request);
    });

    it('startVM makes POST request to start endpoint', async () => {
      const mockVM: VM = { 
        id: '123', 
        name: 'test-vm', 
        status: 'running',
        vcpus: 2,
        memoryMib: 1024,
        imageId: 'img-1',
        pid: 12345,
        socketPath: '/tmp/test.sock',
        tapDevice: 'tap0',
        macAddress: '00:00:00:00:00:01',
        ipAddress: '10.0.100.2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockVM), { status: 200 }))
      );

      await startVM('123', config);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:3000/api/vms/123/start',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('stopVM makes POST request to stop endpoint', async () => {
      const mockVM: VM = { 
        id: '123', 
        name: 'test-vm', 
        status: 'stopped',
        vcpus: 2,
        memoryMib: 1024,
        imageId: 'img-1',
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockVM), { status: 200 }))
      );

      await stopVM('123', config);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:3000/api/vms/123/stop',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Image endpoints', () => {
    it.skip('listImages makes GET request to /api/images', async () => {
      const mockImages: Image[] = [
        { 
          id: 'img-1', 
          reference: 'ghcr.io/test:latest', 
          kernelPath: '/path/kernel', 
          rootfsPath: '/path/rootfs',
          sizeBytes: 1024000,
          pulledAt: '2024-01-01T00:00:00Z',
        },
      ];
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockImages), { status: 200 }))
      );

      const result = await listImages(config);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:3000/api/images',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual(mockImages);
    });

    it('pullImage makes POST request with reference', async () => {
      const mockImage: Image = { 
        id: 'img-2', 
        reference: 'ghcr.io/test:v2', 
        kernelPath: '/path/kernel', 
        rootfsPath: '/path/rootfs',
        sizeBytes: null,
        pulledAt: '2024-01-01T00:00:00Z',
      };
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockImage), { status: 201 }))
      );

      const request = { reference: 'ghcr.io/test:v2' };
      await pullImage(request, config);

      const calls = mockFetch.mock.calls as unknown as [string, { method: string; body: string }][];
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe('http://test-api:3000/api/images/pull');
      expect(calls[0][1].method).toBe('POST');
      expect(JSON.parse(calls[0][1].body)).toEqual(request);
    });

    it('deleteImage makes DELETE request with correct ID', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
      );

      await deleteImage('img-1', config);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:3000/api/images/img-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('createAPIClient factory', () => {
    it('creates client with configured base URL', async () => {
      const mockVMs: VM[] = [{ 
        id: '1', 
        name: 'vm1', 
        status: 'running',
        vcpus: 2,
        memoryMib: 1024,
        imageId: null,
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }];
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockVMs), { status: 200 }))
      );

      const client = createAPIClient(config);
      await client.vms.list();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-api:3000/api/vms',
        expect.anything()
      );
    });

    it('vms.list calls listVMs', async () => {
      const mockVMs: VM[] = [{ 
        id: '1', 
        name: 'vm1', 
        status: 'running',
        vcpus: 2,
        memoryMib: 1024,
        imageId: null,
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }];
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockVMs), { status: 200 }))
      );

      const client = createAPIClient(config);
      const result = await client.vms.list();

      expect(result).toEqual(mockVMs);
    });

    it.skip('images.list calls listImages', async () => {
      const mockImages: Image[] = [{ 
        id: 'img-1', 
        reference: 'test:latest',
        kernelPath: '/path/kernel',
        rootfsPath: '/path/rootfs',
        sizeBytes: 1024000,
        pulledAt: '2024-01-01T00:00:00Z',
      }];
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockImages), { status: 200 }))
      );

      const client = createAPIClient(config);
      const result = await client.images.list();

      expect(result).toEqual(mockImages);
    });
  });
});
