const mockPersistedStore = {
  host: 'https://api.example.com',
  testnetHost: 'https://legacy-testnet.example.com',
  apiKey: 'persi...d',
  apiTime: 1,
};

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn().mockResolvedValue(mockPersistedStore),
  patchPersistStore: jest.fn((store, partials) => {
    Object.assign(store, partials);
  }),
}));

const mockInitSync = jest.fn();
const mockCreateOpenapiClient = jest.fn((store: unknown, adapter: unknown) => ({
  openapi: { initSync: mockInitSync, store, adapter },
  init: async () => undefined,
}));
jest.mock('@/services/openapi/createOpenapiClient', () => ({
  createOpenapiClient: (store: unknown, adapter: unknown) =>
    mockCreateOpenapiClient(store, adapter),
  createReadyOpenapiProxy: (client: unknown) => client,
}));

const mockForcedAdapter = jest.fn();
const mockDefaultAdapter = jest.fn();
jest.mock('@/services/openapi/fetchAdapter', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockDefaultAdapter(...args),
  rabbyOpenapiFetchAdapter: (...args: unknown[]) => mockForcedAdapter(...args),
}));

import openapiService, {
  getOpenapiStore,
  initializeOpenapiStore,
  patchOpenapiStore,
} from '@/background/service/openapi';
import { createPersistStore } from 'background/utils';
import { rabbyOpenapiFetchAdapter } from '@/services/openapi/fetchAdapter';

describe('background OpenAPI store (Hippo privacy policy)', () => {
  beforeEach(() => {
    mockInitSync.mockClear();
  });

  test('background client is bound to the forced-policy adapter (never the default)', () => {
    // The OpenAPI client can target a user-configured custom host, so every
    // request must pass RemoteDataPolicy classification (forceRemoteDataPolicy
    // = true). A default-adapter client would silently allow custom hosts.
    expect(mockCreateOpenapiClient).toHaveBeenCalledTimes(1);
    const adapter = mockCreateOpenapiClient.mock.calls[0][1];
    expect(adapter).toBe(rabbyOpenapiFetchAdapter);
    expect(adapter).toBeDefined();
  });

  test('removes the legacy testnet host and clears persisted identity', async () => {
    await initializeOpenapiStore();

    expect(mockPersistedStore).not.toHaveProperty('testnetHost');
    expect(mockPersistedStore.apiKey).toBeNull();
    expect(mockPersistedStore.apiTime).toBeNull();
    expect(getOpenapiStore()).toEqual({ host: 'https://api.example.com' });
    expect(createPersistStore).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'openapi',
        broadcastKeys: ['host'],
      })
    );
  });

  test('UI patches cannot reintroduce an installation identifier', async () => {
    await initializeOpenapiStore();

    await patchOpenapiStore({
      host: 'https://next-api.example.com',
      apiKey: 'ui-attempted-id',
      apiTime: 999,
    } as any);

    expect(mockPersistedStore.apiKey).toBeNull();
    expect(mockPersistedStore.apiTime).toBeNull();
    expect(getOpenapiStore()).toEqual({
      host: 'https://next-api.example.com',
    });
    expect(mockInitSync).toHaveBeenCalled();
  });

  test('disables the Rabby RPC control plane and action logging', async () => {
    await expect(openapiService.getDefaultRPCs()).rejects.toMatchObject({
      code: 'RABBY_RPC_DISABLED',
    });
    await expect(
      openapiService.ethRpc('1', {
        method: 'eth_blockNumber',
        params: [],
      } as any)
    ).rejects.toMatchObject({ code: 'RABBY_RPC_DISABLED' });
    await expect(
      openapiService.postActionLog({ id: 'x', type: 'tx', rules: [] } as any)
    ).resolves.toBeUndefined();
  });
});
