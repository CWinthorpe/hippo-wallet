/**
 * @jest-environment jsdom
 */

const storageGet = jest.fn();
const storageSet = jest.fn();
const updateDynamicRules = jest.fn();

jest.mock('webextension-polyfill', () => ({
  storage: {
    local: {
      get: (...args: any[]) => storageGet(...args),
      set: (...args: any[]) => storageSet(...args),
    },
  },
}));

import {
  classifyRemoteDataEndpoint,
  EMPTY_REMOTE_DATA_CAPABILITIES,
  isKnownRabbyOrDeBankUrl,
  RemoteDataPolicyError,
  RemoteDataPolicyService,
} from '@/background/service/remoteDataPolicy';

describe('Rabby/DeBank remote data policy', () => {
  beforeEach(() => {
    storageGet.mockReset().mockResolvedValue({});
    storageSet.mockReset().mockResolvedValue(undefined);
    updateDynamicRules.mockReset().mockResolvedValue(undefined);
    (globalThis as any).chrome = {
      declarativeNetRequest: { updateDynamicRules },
    };
  });

  test('starts fail-closed when no policy has been configured', async () => {
    const service = new RemoteDataPolicyService();
    await service.init();

    expect(service.getPolicy()).toMatchObject({
      configured: false,
      capabilities: EMPTY_REMOTE_DATA_CAPABILITIES,
    });
    expect(() =>
      service.assertRequestAllowed(
        'https://api.rabby.io/v1/user/total_balance?id=0x1',
        true
      )
    ).toThrow(
      expect.objectContaining<Partial<RemoteDataPolicyError>>({
        code: 'REMOTE_DATA_DISABLED',
      })
    );
    expect(updateDynamicRules).toHaveBeenCalledWith(
      expect.objectContaining({
        addRules: [expect.objectContaining({ action: { type: 'block' } })],
      })
    );
  });

  test('allows only explicitly enabled endpoint categories', async () => {
    const service = new RemoteDataPolicyService();
    await service.init();
    await service.setPolicy({ portfolio: true });

    expect(() =>
      service.assertRequestAllowed(
        'https://api.rabby.io/v1/user/total_balance?id=0x1',
        true
      )
    ).not.toThrow();
    expect(() =>
      service.assertRequestAllowed(
        'https://api.rabby.io/v1/user/history_list?id=0x1',
        true
      )
    ).toThrow(
      expect.objectContaining<Partial<RemoteDataPolicyError>>({
        code: 'REMOTE_DATA_DISABLED',
      })
    );
    expect(() =>
      service.assertRequestAllowed(
        'https://api.rabby.io/v1/wallet/unknown_new_endpoint',
        true
      )
    ).toThrow(
      expect.objectContaining<Partial<RemoteDataPolicyError>>({
        code: 'REMOTE_DATA_UNCLASSIFIED',
      })
    );
  });

  test('removed endpoint families remain blocked even when all categories are enabled', async () => {
    const service = new RemoteDataPolicyService();
    await service.init();
    await service.setPolicy({
      portfolio: true,
      history: true,
      nft: true,
      signing: true,
      approvals: true,
      security: true,
      dapps: true,
      feedback: true,
    });

    for (const url of [
      'https://api.rabby.io/v2/points/user',
      'https://api.rabby.io/v2/bridge/quote_list',
      'https://api.rabby.io/v1/gas_account',
      'https://api.rabby.io/v1/wallet/gas_station/order',
      'https://api.rabby.io/v1/nft/order/listing/prepare',
      'https://api.rabby.io/v1/wallet/swap_quote',
      'https://api.rabby.io/v1/wallet/gas_market',
      'https://api.rabby.io/v2/wallet/submit_tx',
    ]) {
      expect(() => service.assertRequestAllowed(url, true)).toThrow(
        expect.objectContaining<Partial<RemoteDataPolicyError>>({
          code: 'REMOTE_FEATURE_REMOVED',
        })
      );
    }
  });

  test('classifies retained boundaries and recognizes upstream hosts', () => {
    expect(
      classifyRemoteDataEndpoint('https://api.rabby.io/v1/engine/action/parse_tx')
    ).toEqual(['signing']);
    expect(
      classifyRemoteDataEndpoint(
        'https://api.rabby.io/v1/user/token_authorized_list'
      )
    ).toEqual(['approvals']);
    expect(
      classifyRemoteDataEndpoint('https://api.rabby.io/v1/user/has_new_tx')
    ).toEqual(['history']);
    expect(
      classifyRemoteDataEndpoint('https://api.rabby.io/v1/engine/addr/desc')
    ).toEqual(['security', 'signing']);
    expect(isKnownRabbyOrDeBankUrl('https://static.debank.com/image.png')).toBe(
      true
    );
    expect(isKnownRabbyOrDeBankUrl('https://safe-transaction.example')).toBe(
      false
    );
  });

  test('notifies request adapters when settings change so in-flight calls can abort', async () => {
    const service = new RemoteDataPolicyService();
    const listener = jest.fn();
    const unsubscribe = service.onPolicyChange(listener);
    await service.init();

    await service.setPolicy({ portfolio: true });
    expect(listener).toHaveBeenCalledTimes(1);

    await service.setPolicy({ portfolio: false });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await service.setPolicy({ portfolio: true });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
