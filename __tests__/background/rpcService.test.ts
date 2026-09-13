/**
 * @jest-environment jsdom
 */

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn(),
}));

jest.mock('@/utils/chain', () => ({
  findChainByEnum: jest.fn(() => ({ enum: 'ETH' })),
  findChainByServerID: jest.fn((serverId: string) =>
    serverId === 'eth' ? { enum: 'ETH', serverId } : undefined
  ),
  getChainList: jest.fn(() => []),
}));

jest.mock('@/constant', () => ({
  CUSTOM_RPC_ENABLED: true,
  INTERNAL_REQUEST_ORIGIN: 'internal',
}));

jest.mock('@/background/service/openapi', () => ({
  __esModule: true,
  default: {
    getDefaultRPCs: jest.fn(),
    ethRpc: jest.fn(),
  },
}));

import {
  RPCService,
  MEV_BLOCKER_FULL_PRIVACY_RPC,
  canUseReadFallback,
  isRetryableRPCError,
  normalizeRPCItem,
  validateRPCResult,
} from '@/background/service/rpc';
import { CHAINS_ENUM } from '@debank/common';
import openapiService from '@/background/service/openapi';
import fs from 'fs';
import path from 'path';
import { keccak256 } from 'viem';

describe('RPC read failover and broadcast routing', () => {
  const primary = 'https://primary.example';
  const fallback = 'https://fallback.example';
  const broadcast = 'https://broadcast.example';

  const createService = () => {
    const service = new RPCService();
    service.store.customRPC[CHAINS_ENUM.ETH] = {
      url: primary,
      fallbackUrls: [fallback],
      broadcastUrl: broadcast,
      enable: true,
    };
    service.request = jest.fn() as any;
    return service;
  };

  test('falls back in order for a retryable read failure', async () => {
    const service = createService();
    (service.request as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce('0x123');

    await expect(
      service.requestCustomRPC(CHAINS_ENUM.ETH, 'eth_blockNumber', [])
    ).resolves.toBe('0x123');
    expect(service.request).toHaveBeenNthCalledWith(
      1,
      primary,
      'eth_blockNumber',
      []
    );
    expect(service.request).toHaveBeenNthCalledWith(
      2,
      fallback,
      'eth_blockNumber',
      []
    );
  });

  test('falls back when a read endpoint returns a malformed result', async () => {
    const service = createService();
    (service.request as jest.Mock)
      .mockResolvedValueOnce('rate limit exceeded')
      .mockResolvedValueOnce('0x123');

    await expect(
      service.requestCustomRPC(CHAINS_ENUM.ETH, 'eth_blockNumber', [])
    ).resolves.toBe('0x123');
    expect(service.request).toHaveBeenCalledTimes(2);
  });

  test('accepts null where JSON-RPC uses it as a legitimate not-found result', () => {
    expect(
      validateRPCResult(
        'eth_getTransactionReceipt',
        null,
        'https://primary.example/private-key'
      )
    ).toBeNull();
  });

  test('sanitizes endpoint credentials in malformed-result errors', () => {
    expect(() =>
      validateRPCResult(
        'eth_blockNumber',
        'overloaded',
        'https://primary.example/private-api-key'
      )
    ).toThrow('Invalid eth_blockNumber result from https://primary.example');
  });

  test('does not leak semantic RPC failures to a fallback', async () => {
    const service = createService();
    const revert = { code: 3, message: 'execution reverted' };
    (service.request as jest.Mock).mockRejectedValue(revert);

    await expect(
      service.requestCustomRPC(CHAINS_ENUM.ETH, 'eth_call', [])
    ).rejects.toBe(revert);
    expect(service.request).toHaveBeenCalledTimes(1);
  });

  test('never retries a signed transaction and uses only the broadcast RPC', async () => {
    const service = createService();
    const error = { response: { status: 503 } };
    (service.request as jest.Mock).mockRejectedValue(error);

    await expect(
      service.requestCustomRPC(CHAINS_ENUM.ETH, 'eth_sendRawTransaction', [
        '0xsigned',
      ])
    ).rejects.toBe(error);
    expect(service.request).toHaveBeenCalledTimes(1);
    expect(service.request).toHaveBeenCalledWith(
      broadcast,
      'eth_sendRawTransaction',
      ['0xsigned']
    );
  });

  test('rejects an invalid transaction hash without trying another RPC', async () => {
    const service = createService();
    (service.request as jest.Mock).mockResolvedValue('not-a-transaction-hash');

    await expect(
      service.requestCustomRPC(CHAINS_ENUM.ETH, 'eth_sendRawTransaction', [
        '0xsigned',
      ])
    ).rejects.toThrow(
      'Invalid transaction hash from https://broadcast.example'
    );
    expect(service.request).toHaveBeenCalledTimes(1);
  });

  test('does not fail over wallet-controlled send methods', async () => {
    const service = createService();
    (service.request as jest.Mock).mockRejectedValue({
      response: { status: 429 },
    });

    await expect(
      service.requestCustomRPC(CHAINS_ENUM.ETH, 'eth_sendTransaction', [{}])
    ).rejects.toBeDefined();
    expect(service.request).toHaveBeenCalledTimes(1);
    expect(service.request).toHaveBeenCalledWith(
      primary,
      'eth_sendTransaction',
      [{}]
    );
  });

  test('default read traffic uses ordered RPC endpoints before the wallet backend', async () => {
    const service = createService();
    service.store.defaultRPC = {
      eth: {
        chainId: 'eth',
        rpcUrl: [primary, fallback],
      } as any,
    };
    service.defaultRPCRequest = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce('0x123') as any;

    await expect(
      service.requestDefaultRPC({
        chainServerId: 'eth',
        method: 'eth_blockNumber',
        params: [],
      })
    ).resolves.toBe('0x123');
    expect(service.defaultRPCRequest).toHaveBeenNthCalledWith(
      1,
      primary,
      'eth_blockNumber',
      []
    );
    expect(service.defaultRPCRequest).toHaveBeenNthCalledWith(
      2,
      fallback,
      'eth_blockNumber',
      []
    );
  });

  test('default signed broadcast also uses only the first endpoint', async () => {
    const service = createService();
    service.store.defaultRPC = {
      eth: {
        chainId: 'eth',
        rpcUrl: [primary, fallback],
      } as any,
    };
    service.defaultRPCRequest = jest
      .fn()
      .mockRejectedValue({ response: { status: 503 } }) as any;

    await expect(
      service.defaultRPCSubmitTxWithFallback('eth', 'eth_sendRawTransaction', [
        '0xsigned',
      ])
    ).rejects.toBeDefined();
    expect(service.defaultRPCRequest).toHaveBeenCalledTimes(1);
    expect(service.defaultRPCRequest).toHaveBeenCalledWith(
      primary,
      'eth_sendRawTransaction',
      ['0xsigned']
    );
  });

  test('does not fail over stateful filter methods', async () => {
    const service = createService();
    (service.request as jest.Mock).mockRejectedValue({
      response: { status: 429 },
    });

    await expect(
      service.requestCustomRPC(CHAINS_ENUM.ETH, 'eth_getFilterChanges', ['0x1'])
    ).rejects.toBeDefined();
    expect(service.request).toHaveBeenCalledTimes(1);
  });

  test('health checks use the short timeout and can reach a fallback', async () => {
    const service = createService();
    (service.request as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce('0x123');

    await expect(service.ping(CHAINS_ENUM.ETH)).resolves.toBe(true);
    expect(service.request).toHaveBeenNthCalledWith(
      1,
      primary,
      'eth_blockNumber',
      [],
      2000
    );
    expect(service.request).toHaveBeenNthCalledWith(
      2,
      fallback,
      'eth_blockNumber',
      [],
      2000
    );
  });

  test('classifies transport and rate-limit failures only', () => {
    expect(isRetryableRPCError({ response: { status: 429 } })).toBe(true);
    expect(isRetryableRPCError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryableRPCError({ code: -32005 })).toBe(true);
    expect(isRetryableRPCError({ code: '-32005' })).toBe(true);
    expect(isRetryableRPCError({ code: 'INVALID_RPC_RESULT' })).toBe(true);
    expect(
      isRetryableRPCError({ code: -32016, message: 'execution reverted' })
    ).toBe(false);
    expect(
      isRetryableRPCError({ code: -32603, message: 'invalid params' })
    ).toBe(false);
    expect(
      isRetryableRPCError({
        response: { data: { error: { message: 'provider overloaded' } } },
      })
    ).toBe(true);
    expect(
      isRetryableRPCError({ code: 3, message: 'execution reverted' })
    ).toBe(false);
  });

  test('limits automatic failover to stateless reads and estimates', () => {
    expect(canUseReadFallback('eth_getBalance')).toBe(true);
    expect(canUseReadFallback('eth_estimateGas')).toBe(true);
    expect(canUseReadFallback('eth_getFilterChanges')).toBe(false);
    expect(canUseReadFallback('eth_getWork')).toBe(false);
    expect(canUseReadFallback('eth_sendTransaction')).toBe(false);
    expect(canUseReadFallback('eth_sendRawTransaction')).toBe(false);
  });

  test('normalizes and de-duplicates persisted endpoint lists', () => {
    expect(
      normalizeRPCItem({
        url: ` ${primary} `,
        fallbackUrls: [primary, ` ${fallback} `, fallback],
        broadcastUrl: '  ',
        enable: true,
      })
    ).toEqual({
      url: primary,
      fallbackUrls: [fallback],
      enable: true,
    });
  });

  test('changing a profile invalidates endpoint-sensitive cache identity', () => {
    const service = createService();
    service.store.customRPC[CHAINS_ENUM.ETH].enable = false;
    service.rpcStatus[CHAINS_ENUM.ETH] = {
      available: true,
      expireAt: Date.now() + 60_000,
    };

    service.setRPC(CHAINS_ENUM.ETH, 'https://replacement.example');

    expect(service.getRoutingVersion()).toBe(1);
    expect(service.rpcStatus[CHAINS_ENUM.ETH]).toBeUndefined();
    expect(service.store.customRPC[CHAINS_ENUM.ETH]).toEqual({
      url: 'https://replacement.example',
      enable: false,
    });
  });

  test('uses the bundled privacy provider hierarchy without querying Rabby', async () => {
    const service = new RPCService();
    (openapiService.getDefaultRPCs as jest.Mock).mockClear();

    await service.syncDefaultRPC();

    expect(openapiService.getDefaultRPCs).not.toHaveBeenCalled();
    expect(service.getDefaultRPC('eth')).toEqual({
      chainId: 'eth',
      rpcUrl: [
        'https://public.1rpc.io/eth',
        'https://eth.drpc.org',
        'https://ethereum-rpc.publicnode.com',
        'https://0xrpc.io/eth',
      ],
      txPushToRPC: true,
    });
    expect(service.getDefaultRPC('metis')).toEqual({
      chainId: 'metis',
      rpcUrl: ['https://metis.drpc.org'],
      txPushToRPC: true,
    });
    expect(service.getDefaultRPC('cfx')).toBeUndefined();
  });

  test('never falls back to the Rabby RPC proxy when a bundled route is missing', async () => {
    const service = new RPCService();
    (openapiService.ethRpc as jest.Mock).mockClear();

    await expect(
      service.requestDefaultRPC({
        chainServerId: 'cfx',
        method: 'eth_blockNumber',
        params: [],
      })
    ).rejects.toThrow('Configure a custom RPC');
    expect(openapiService.ethRpc).not.toHaveBeenCalled();
  });

  test('recognizes the documented 1RPC quota error as retryable', () => {
    expect(
      isRetryableRPCError({
        code: -32001,
        message: 'Daily usage quota exceeded',
      })
    ).toBe(true);
  });

  test('keeps custom RPC routing ahead of the bundled default route', () => {
    const providerSource = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../src/background/controller/provider/controller.ts'
      ),
      'utf8'
    );
    const customRoute = providerSource.indexOf(
      'if (RPCService.hasCustomRPC(chain.enum as CHAINS_ENUM))'
    );
    const defaultRoute = providerSource.indexOf(
      'RPCService.requestDefaultRPC({',
      customRoute
    );

    expect(customRoute).toBeGreaterThan(-1);
    expect(defaultRoute).toBeGreaterThan(customRoute);
  });

  test('custom RPC remains authoritative for guarded raw transaction submission', async () => {
    const service = createService();
    const rawTx = '0x01' as const;
    const hash = keccak256(rawTx);
    service.requestCustomRPC = jest.fn().mockResolvedValue(hash) as any;
    service.defaultRPCRequest = jest.fn() as any;

    await expect(
      service.submitRawTransaction({
        chain: CHAINS_ENUM.ETH,
        chainServerId: 'eth',
        rawTx,
        allowMevBlocker: true,
      })
    ).resolves.toMatchObject({
      hash,
      usedMevBlocker: false,
      submissionEndpoint: broadcast,
    });
    expect(service.requestCustomRPC).toHaveBeenCalledTimes(1);
    expect(service.defaultRPCRequest).not.toHaveBeenCalled();
  });

  test('uses MEV Blocker full-privacy submission once for eligible Ethereum transactions', async () => {
    const service = new RPCService();
    const rawTx = '0x01' as const;
    const hash = keccak256(rawTx);
    service.defaultRPCRequest = jest.fn().mockResolvedValue(hash) as any;

    await expect(
      service.submitRawTransaction({
        chain: CHAINS_ENUM.ETH,
        chainServerId: 'eth',
        rawTx,
        allowMevBlocker: true,
      })
    ).resolves.toMatchObject({
      hash,
      usedMevBlocker: true,
      submissionEndpoint: MEV_BLOCKER_FULL_PRIVACY_RPC,
    });
    expect(service.defaultRPCRequest).toHaveBeenCalledTimes(1);
    expect(service.defaultRPCRequest).toHaveBeenCalledWith(
      MEV_BLOCKER_FULL_PRIVACY_RPC,
      'eth_sendRawTransaction',
      [rawTx]
    );
  });

  test('treats malformed submission results as ambiguous and never rebroadcasts', async () => {
    const service = new RPCService();
    const rawTx = '0x01' as const;
    service.defaultRPCRequest = jest.fn().mockResolvedValue('malformed') as any;

    await expect(
      service.submitRawTransaction({
        chain: CHAINS_ENUM.ETH,
        chainServerId: 'eth',
        rawTx,
        allowMevBlocker: true,
      })
    ).rejects.toMatchObject({
      code: 'RAW_TX_RESULT_INVALID',
      ambiguousSubmission: true,
      localTransactionHash: keccak256(rawTx),
    });
    expect(service.defaultRPCRequest).toHaveBeenCalledTimes(1);
  });

  test('receipt reads prefer the enabled custom RPC over defaults', async () => {
    const service = createService();
    (service.request as jest.Mock).mockImplementation(async (host, _m, _p) => {
      if (host === primary) return { result: '0x1' };
      throw new Error(`unexpected host ${host}`);
    });

    await service.requestReadRPC({
      chainServerId: 'eth',
      method: 'eth_getTransactionReceipt',
      params: ['0xabc'],
    });
    // Every call targeted the custom endpoint list; the bundled default
    // privacy host was never contacted while a custom RPC is enabled.
    const hosts = (service.request as jest.Mock).mock.calls.map((c) => c[0]);
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.every((h) => h === primary || h === fallback)).toBe(true);
    expect(hosts[0]).toBe(primary);
  });

  test('receipt reads use the default privacy list only without a custom RPC', async () => {
    const service = new RPCService();
    service.store.defaultRPC = service.store.defaultRPC || {};
    service.store.defaultRPC['eth'] = {
      chainServerId: 'eth',
      rpcUrl: ['https://default.example'],
    } as any;
    service.defaultRPCRequest = jest
      .fn()
      .mockResolvedValue('0x1') as any;

    await expect(
      service.requestReadRPC({
        chainServerId: 'eth',
        method: 'eth_getTransactionReceipt',
        params: ['0xabc'],
      })
    ).resolves.toBe('0x1');
    expect(service.defaultRPCRequest).toHaveBeenCalledWith(
      'https://default.example',
      'eth_getTransactionReceipt',
      ['0xabc']
    );
  });

  test('history and watcher receipt polling never call requestDefaultRPC directly', () => {
    const watcherSource = fs.readFileSync(
      path.resolve(__dirname, '../../src/background/service/transactionWatcher.ts'),
      'utf8'
    );
    const historySource = fs.readFileSync(
      path.resolve(__dirname, '../../src/background/service/transactionHistory.ts'),
      'utf8'
    );
    expect(watcherSource).toContain('requestReadRPC');
    expect(watcherSource).not.toContain(
      "RPCService.requestDefaultRPC({\n      chainServerId: chainItem.serverId,\n      method: 'eth_getTransactionReceipt'"
    );
    expect(historySource).toContain('requestReadRPC');
    expect(historySource).not.toMatch(
      /getRpcTxReceipt[^}]*requestDefaultRPC/s
    );
  });

  test('provider broadcast path has no Rabby, gas-account, or bridge submission fallback', () => {
    const providerSource = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../src/background/controller/provider/controller.ts'
      ),
      'utf8'
    );
    expect(providerSource).toContain('RPCService.submitRawTransaction({');
    expect(providerSource).toContain('allowMevBlocker');
    expect(providerSource).not.toContain('openapiService.submitTxV2');
    expect(providerSource).not.toContain('gasAccountService');
    expect(providerSource).not.toContain('bridgeService');
  });
});
