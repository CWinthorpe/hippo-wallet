const mockLegacyOpenapiStore = {
  host: 'https://api.example.com',
  testnetHost: 'https://legacy-testnet.example.com',
  apiKey: 'persisted-id',
  apiTime: 1,
};
const mockReconfigure = jest.fn().mockResolvedValue(undefined);

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn().mockResolvedValue(mockLegacyOpenapiStore),
  patchPersistStore: jest.fn((store, partials) => {
    Object.assign(store, partials);
  }),
}));

jest.mock('@/services/openapi', () => {
  const actual = jest.requireActual('@/services/openapi');
  return {
    ...actual,
    createOpenapiRuntime: jest.fn(() => ({
      openapi: { initSync: jest.fn() },
      ready: Promise.resolve(),
      reconfigure: mockReconfigure,
      dispose: jest.fn(),
    })),
  };
});

import {
  getOpenapiStore,
  initializeOpenapiStore,
  patchOpenapiStore,
} from '@/background/service/openapi';
import { createPersistStore } from 'background/utils';

describe('background OpenAPI store', () => {
  beforeEach(() => {
    mockReconfigure.mockClear();
  });

  test('removes the legacy testnet host and keeps installation identity out of the UI-shared half', async () => {
    await initializeOpenapiStore();

    expect(mockLegacyOpenapiStore).not.toHaveProperty('testnetHost');
    // Hippo: apiKey/apiTime are never exposed to UI pages and are forced null
    // by the background store itself (no persistent installation identifier).
    expect(getOpenapiStore()).toEqual({
      host: 'https://api.example.com',
    });
    expect(mockLegacyOpenapiStore.apiKey).toBeNull();
    expect(mockLegacyOpenapiStore.apiTime).toBeNull();
    expect(createPersistStore).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'openapi',
        broadcastKeys: ['host'],
      })
    );
  });

  test('host updates reconfigure the background client; identity writes are dropped', async () => {
    await patchOpenapiStore({
      apiKey: 'new-id',
      apiTime: 2,
    } as never);

    // Identity-only patches never reach the store or the client config.
    expect(mockReconfigure).not.toHaveBeenCalled();
    expect(mockLegacyOpenapiStore.apiKey).toBeNull();

    await patchOpenapiStore({ host: 'https://api.example.com' });
    expect(getOpenapiStore()).toEqual({ host: 'https://api.example.com' });
  });
});
