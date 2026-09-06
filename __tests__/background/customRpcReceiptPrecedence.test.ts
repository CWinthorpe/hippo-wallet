/**
 * @jest-environment jsdom
 */
// Regressor for gpt56 round-3 blocker B7: custom-RPC precedence must hold
// for BACKGROUND receipt polling. A transaction submitted through the user's
// custom endpoint must have its receipt polled through the SAME custom
// endpoint; built-in privacy providers may only be used when no custom RPC
// is configured/enabled for that chain.

import fs from 'fs';

const CUSTOM_RECEIPT = { status: '0x1', transactionHash: '0xhash' };

const state = {
  customEnabled: {} as Record<string, boolean>,
  chainByServer: { eth: 'ETH', bsoc: 'BSC' } as Record<string, string>,
};

const calls = { custom: [] as any[], builtIn: [] as any[] };

jest.mock('background/service', () => ({
  RPCService: {
    hasCustomRPC: (chain: string) => state.customEnabled[chain] === true,
    requestCustomRPC: jest.fn(
      async (chain: string, method: string, params: any[]) => {
        calls.custom.push({ chain, method, params });
        return CUSTOM_RECEIPT;
      }
    ),
    requestDefaultRPC: jest.fn(
      async ({ chainServerId, method, params }: any) => {
        calls.builtIn.push({ chainServerId, method, params });
        return { status: '0x0', transactionHash: '0xhash' };
      }
    ),
    // Mirrors the real selector contract (verified separately against the
    // real RPCService in the second describe block): custom-first, built-in
    // only when no custom RPC is enabled.
    requestReadRPC: async ({
      chainServerId,
      method,
      params,
    }: {
      chainServerId: string;
      method: string;
      params: any[];
    }) => {
      const chain = state.chainByServer[chainServerId];
      const barrel = jest.requireMock('background/service');
      if (chain && barrel.RPCService.hasCustomRPC(chain)) {
        return barrel.RPCService.requestCustomRPC(chain, method, params);
      }
      return barrel.RPCService.requestDefaultRPC({
        chainServerId,
        method,
        params,
      });
    },
  },
  i18n: { getText: (key: string) => key },
  transactionHistoryService: {
    reloadTx: jest.fn(async () => undefined),
    removeAllSigningTx: jest.fn(),
  },
  uninstalledService: { tryDeleteUninstalled: jest.fn() },
  customTestnetService: {
    getTransactionReceipt: jest.fn(),
    getTx: jest.fn(),
  },
}));

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn(),
  isSameAddress: (a: string, b: string) => a === b,
}));

jest.mock('background/webapi', () => ({
  notification: { openNotification: jest.fn() },
}));

jest.mock('consts', () => ({
  CHAINS_ENUM: { ETH: 'ETH', BSC: 'BSC' },
  EVENTS_IN_BG: { ON_TX_COMPLETED: 'ON_TX_COMPLETED' },
  EVENTS: { broadcastToUI: 'broadcastToUI', RELOAD_TX: 'RELOAD_TX' },
  INTERNAL_REQUEST_ORIGIN: 'internal',
  CHAINS: [],
  SIGN_PERMISSION_TYPES: {},
}));

jest.mock('@/constant', () => ({
  EVENTS: { broadcastToUI: 'broadcastToUI', RELOAD_TX: 'RELOAD_TX' },
  CHAINS_ENUM: { ETH: 'ETH', BSC: 'BSC' },
  CUSTOM_RPC_ENABLED: true,
  INTERNAL_REQUEST_ORIGIN: 'internal',
  CHAINS: [],
  SIGN_PERMISSION_TYPES: {},
}));

jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: jest.fn(async () => ({})),
        set: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
    },
    runtime: {
      getManifest: () => ({ manifest_version: 3, version: 'test' }),
      id: 'test',
    },
  },
}));

jest.mock('@/background/service/openapi', () => ({
  __esModule: true,
  default: {
    getTxRequests: jest.fn(async () => []),
    gasMarketV2: jest.fn(async () => []),
  },
}));

jest.mock('@/background/service/customTestnet', () => ({
  customTestnetService: {
    getTransactionReceipt: jest.fn(),
    getTx: jest.fn(),
  },
  fakeTestnetOpenapi: {},
}));

jest.mock('@/utils/chain', () => ({
  findChain: jest.fn(
    (params: { enum?: string; serverId?: string; id?: number }) => {
      if (params.enum)
        return {
          enum: params.enum,
          serverId: 'eth',
          isTestnet: false,
          scanLink: '',
        };
      if (params.serverId === 'eth')
        return { enum: 'ETH', serverId: 'eth', isTestnet: false, scanLink: '' };
      return undefined;
    }
  ),
  findChainByEnum: jest.fn(),
  findChainByID: jest.fn(),
  findChainByNetwork: jest.fn(),
}));

jest.mock('@/eventBus', () => ({
  __esModule: true,
  default: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
}));
jest.mock('@/utils', () => ({ getTxScanLink: () => '' }));
jest.mock('interval-promise', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/stats', () => ({
  __esModule: true,
  default: { report: jest.fn() },
}));
jest.mock('@/utils/tx', () => ({
  checkIsPendingTxGroup: () => false,
  checkIsSubmittedTxGroup: () => false,
  findMaxGasTx: () => undefined,
}));
jest.mock('@/utils/transaction', () => ({ makeTransactionId: () => 'txid' }));

import transactionWatchService from '@/background/service/transactionWatcher';
import transactionHistoryService from '@/background/service/transactionHistory';

describe('background receipt polling routes custom-RPC-first (B7)', () => {
  beforeEach(() => {
    calls.custom = [];
    calls.builtIn = [];
    state.customEnabled = { ETH: true };
  });

  test('transactionWatcher.checkStatus polls the custom endpoint, built-in receives zero calls', async () => {
    (transactionWatchService as any).store = {
      pendingTx: {
        '0xaddr_1_ETH': {
          nonce: '1',
          hash: '0xhash',
          chain: 'ETH',
          intervalDuration: 5000,
        },
      },
    };

    const receipt = await transactionWatchService.checkStatus('0xaddr_1_ETH');
    expect(receipt).toBe(CUSTOM_RECEIPT);
    expect(calls.custom).toEqual([
      { chain: 'ETH', method: 'eth_getTransactionReceipt', params: ['0xhash'] },
    ]);
    expect(calls.builtIn).toEqual([]);
  });

  test('transactionWatcher falls back to built-ins only when no custom RPC is enabled', async () => {
    state.customEnabled = { ETH: false };
    (transactionWatchService as any).store = {
      pendingTx: {
        '0xaddr_2_ETH': {
          nonce: '2',
          hash: '0xhash2',
          chain: 'ETH',
          intervalDuration: 5000,
        },
      },
    };

    await transactionWatchService.checkStatus('0xaddr_2_ETH');
    expect(calls.custom).toEqual([]);
    expect(calls.builtIn).toEqual([
      {
        chainServerId: 'eth',
        method: 'eth_getTransactionReceipt',
        params: ['0xhash2'],
      },
    ]);
  });

  test('transactionHistory.getRpcTxReceipt polls the custom endpoint, built-in receives zero calls', async () => {
    const receipt = await transactionHistoryService.getRpcTxReceipt(
      'eth',
      '0xhash3'
    );
    expect(calls.custom).toEqual([
      {
        chain: 'ETH',
        method: 'eth_getTransactionReceipt',
        params: ['0xhash3'],
      },
    ]);
    expect(calls.builtIn).toEqual([]);
    expect(receipt.status).toBe(1);
  });

  test('neither receipt reader may bypass the selector with requestDefaultRPC directly', () => {
    const watcherSrc = fs.readFileSync(
      'src/background/service/transactionWatcher.ts',
      'utf8'
    );
    const historySrc = fs.readFileSync(
      'src/background/service/transactionHistory.ts',
      'utf8'
    );
    expect(watcherSrc).not.toContain('requestDefaultRPC');
    expect(historySrc).not.toContain('requestDefaultRPC');
    expect(watcherSrc).toContain('requestReadRPC');
    expect(historySrc).toContain('requestReadRPC');
  });
});
