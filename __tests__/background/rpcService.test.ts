/**
 * @jest-environment jsdom
 */

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn(),
}));

jest.mock('@/utils/chain', () => ({
  findChainByEnum: jest.fn(() => ({ enum: 'ETH' })),
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
  canUseReadFallback,
  isRetryableRPCError,
  normalizeRPCItem,
  validateRPCResult,
} from '@/background/service/rpc';
import { CHAINS_ENUM } from '@debank/common';
import openapiService from '@/background/service/openapi';
import fs from 'fs';
import path from 'path';

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

  test('direct default-RPC broadcast does not fall back to the wallet backend', () => {
    const providerSource = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../src/background/controller/provider/controller.ts'
      ),
      'utf8'
    );
    const directBranchStart = providerSource.indexOf("pushType !== 'mev'");
    const backendOnlyBranchStart = providerSource.indexOf(
      'adoptBE7702Params();',
      directBranchStart
    );

    expect(directBranchStart).toBeGreaterThan(-1);
    expect(backendOnlyBranchStart).toBeGreaterThan(directBranchStart);
    expect(
      providerSource.slice(directBranchStart, backendOnlyBranchStart)
    ).not.toContain('openapiService.submitTxV2');
  });
});
