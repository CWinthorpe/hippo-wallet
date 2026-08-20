jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: jest.fn().mockResolvedValue({}),
      },
    },
  },
}));

jest.mock('consts', () => ({
  CHAINS: {},
  CHAINS_ENUM: { ETH: 'ETH' },
  EVENTS: { broadcastToUI: 'broadcastToUI' },
}));

import browser from 'webextension-polyfill';
import type { Chain } from '@debank/common';
import {
  getMainnetListFromLocal,
  mergeMainnetChainInventory,
} from '@/utils/chain';

const makeChain = (
  serverId: string,
  id: number,
  name: string,
  extra: Record<string, unknown> = {}
) =>
  ({
    serverId,
    id,
    name,
    ...extra,
  } as unknown as Chain);

describe('bundled mainnet chain inventory', () => {
  const storageGet = browser.storage.local.get as jest.Mock;

  beforeEach(() => {
    storageGet.mockReset().mockResolvedValue({});
  });

  test('bundled metadata wins while cache-only chains remain available', () => {
    const merged = mergeMainnetChainInventory(
      [
        makeChain('eth', 1, 'Ethereum current'),
        makeChain('xdc', 50, 'XDC'),
      ],
      [
        makeChain('eth', 1, 'Ethereum stale', { cachedMarker: true }),
        makeChain('legacy-only', 123456, 'Legacy only'),
      ]
    );

    expect(merged.map((chain) => chain.serverId)).toEqual([
      'eth',
      'xdc',
      'legacy-only',
    ]);
    expect(merged[0]).toMatchObject({
      name: 'Ethereum current',
      cachedMarker: true,
    });
  });

  test('a legacy cache cannot hide newly bundled chains', async () => {
    storageGet.mockResolvedValue({
      rabbyMainnetChainList: [
        makeChain('eth', 1, 'Ethereum stale'),
        makeChain('legacy-only', 123456, 'Legacy only'),
      ],
    });

    const list = await getMainnetListFromLocal();
    const serverIds = new Set(list.map((chain) => chain.serverId));

    expect(serverIds.has('xdc')).toBe(true);
    expect(serverIds.has('kite')).toBe(true);
    expect(serverIds.has('hood')).toBe(true);
    expect(serverIds.has('legacy-only')).toBe(true);
    expect(list.find((chain) => chain.serverId === 'eth')?.name).not.toBe(
      'Ethereum stale'
    );
  });
});
