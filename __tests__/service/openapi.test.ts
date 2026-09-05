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
jest.mock('@/services/openapi/createOpenapiClient', () => ({
  createOpenapiClient: (store: unknown) => ({
    openapi: { initSync: mockInitSync, store },
    init: async () => undefined,
  }),
  createReadyOpenapiProxy: (client: unknown) => client,
}));

import openapiService, {
  getOpenapiStore,
  initializeOpenapiStore,
  patchOpenapiStore,
} from '@/background/service/openapi';
import { createPersistStore } from 'background/utils';

describe('background OpenAPI store (Hippo privacy policy)', () => {
  beforeEach(() => {
    mockInitSync.mockClear();
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
