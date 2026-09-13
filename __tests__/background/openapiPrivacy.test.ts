const mockStores: any[] = [];

jest.mock('@/constant', () => ({
  INITIAL_OPENAPI_URL: 'https://api.example',
  INITIAL_TESTNET_OPENAPI_URL: 'https://testnet-api.example',
}));

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn().mockResolvedValue({
    host: 'https://api.example',
    testnetHost: 'https://testnet-api.example',
    apiKey: 'persi...id',
    apiTime: 123456,
  }),
  patchPersistStore: jest.fn(),
}));

jest.mock('@rabby-wallet/rabby-api', () => ({
  OpenApiService: class MockOpenApiService {
    initSync = jest.fn();
    init = jest.fn().mockResolvedValue(undefined);
    getDefaultRPCs = jest
      .fn()
      .mockRejectedValue(new Error('real impl must not run'));
    ethRpc = jest.fn().mockRejectedValue(new Error('real impl must not run'));
    postActionLog = jest
      .fn()
      .mockRejectedValue(new Error('real impl must not run'));

    constructor(options: any) {
      mockStores.push(options.store);
    }
  },
}));

jest.mock('@rabby-wallet/rabby-api/dist/plugins/web-sign', () => ({
  WebSignApiPlugin: {},
}));

jest.mock('@/services/openapi/fetchAdapter', () => ({
  __esModule: true,
  default: jest.fn(),
  rabbyOpenapiFetchAdapter: jest.fn(),
}));

import openapiService from '@/background/service/openapi';

describe('private-build functional API identity', () => {
  test('clears persisted installation identifiers and prevents re-enabling them', async () => {
    await Promise.resolve();
    await Promise.resolve();

    expect(mockStores.length).toBeGreaterThanOrEqual(1);
    for (const store of mockStores) {
      // The background store is the Hippo proxy store; the persisted key
      // getters/setters force identity to null.
      expect(store.apiKey).toBeNull();
      expect(store.apiTime).toBeNull();

      store.apiKey = 'new-id';
      store.apiTime = 999;

      expect(store.apiKey).toBeNull();
      expect(store.apiTime).toBeNull();
    }
  });

  test('disables the Rabby default RPC control plane on the API client', async () => {
    await expect(openapiService.getDefaultRPCs()).rejects.toMatchObject({
      code: 'RABBY_RPC_DISABLED',
    });
    await expect(
      openapiService.ethRpc('eth', { method: 'eth_chainId', params: [] })
    ).rejects.toMatchObject({ code: 'RABBY_RPC_DISABLED' });
  });

  test('disables automatic security action logging on the API client', async () => {
    const body = {
      id: 'log-id',
      type: 'tx' as const,
      rules: [{ id: 'rule-id', level: 'warning' }],
    };

    await expect(openapiService.postActionLog(body)).resolves.toBeUndefined();
  });
});
