const mockStores: any[] = [];

jest.mock('@/constant', () => ({
  INITIAL_OPENAPI_URL: 'https://api.example',
  INITIAL_TESTNET_OPENAPI_URL: 'https://testnet-api.example',
}));

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn().mockResolvedValue({
    host: 'https://api.example',
    testnetHost: 'https://testnet-api.example',
    apiKey: 'persisted-upstream-installation-id',
    apiTime: 123456,
  }),
}));

jest.mock('@rabby-wallet/rabby-api', () => ({
  OpenApiService: class MockOpenApiService {
    initSync = jest.fn();

    constructor(options: any) {
      mockStores.push(options.store);
    }
  },
}));

jest.mock('@rabby-wallet/rabby-api/dist/plugins/web-sign', () => ({
  WebSignApiPlugin: {},
}));

jest.mock('background/utils/fetchAdapter', () => jest.fn());

import '@/background/service/openapi';

describe('private-build functional API identity', () => {
  test('clears persisted installation identifiers and prevents re-enabling them', async () => {
    await Promise.resolve();
    await Promise.resolve();

    expect(mockStores).toHaveLength(2);
    for (const store of mockStores) {
      expect(store.apiKey).toBeNull();
      expect(store.apiTime).toBeNull();

      store.apiKey = 'new-id';
      store.apiTime = 999;

      expect(store.apiKey).toBeNull();
      expect(store.apiTime).toBeNull();
    }
  });
});
