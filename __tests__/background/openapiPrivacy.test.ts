jest.mock('@/constant', () => ({
  INITIAL_OPENAPI_URL: 'https://api.example',
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

const mockInitSync = jest.fn();
jest.mock('@/services/openapi/createOpenapiClient', () => ({
  createOpenapiClient: () => ({
    openapi: { initSync: mockInitSync },
    init: async () => undefined,
  }),
  createReadyOpenapiProxy: (client: unknown) => client,
}));

import openapiService from '@/background/service/openapi';

describe('private-build functional API identity', () => {
  test('disables the Rabby default RPC control plane on the API client', async () => {
    await Promise.resolve();
    await Promise.resolve();

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
