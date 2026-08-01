/**
 * @jest-environment jsdom
 */

const requestDefaultRPC = jest.fn();
const requestCustomRPC = jest.fn();
const hasCustomRPC = jest.fn((_chain?: any) => false);

jest.mock('@/background/service/rpc', () => ({
  __esModule: true,
  default: {
    hasCustomRPC: (chain: any) => hasCustomRPC(chain),
    requestDefaultRPC: (request: any) => requestDefaultRPC(request),
    requestCustomRPC: (chain: any, method: any, params: any) =>
      requestCustomRPC(chain, method, params),
  },
}));

jest.mock('@/utils/chain', () => ({
  findChain: jest.fn(() => ({ enum: 'ETH', serverId: 'eth' })),
}));

import { RpcGasService } from '@/background/service/rpcGas';

const rpcResult = (method: string) => {
  switch (method) {
    case 'eth_feeHistory':
      return {
        reward: [
          ['0x3b9aca00', '0x59682f00', '0x77359400'],
          ['0x3b9aca00', '0x59682f00', '0x77359400'],
        ],
      };
    case 'eth_maxPriorityFeePerGas':
      return '0x59682f00';
    case 'eth_getBlockByNumber':
      return { baseFeePerGas: '0x6fc23ac00' };
    case 'eth_gasPrice':
      return '0x773594000';
    default:
      throw new Error(`Unexpected method ${method}`);
  }
};

describe('selected-RPC gas market', () => {
  beforeEach(() => {
    requestDefaultRPC.mockReset();
    requestCustomRPC.mockReset();
    hasCustomRPC.mockReset();
    hasCustomRPC.mockReturnValue(false);
    requestDefaultRPC.mockImplementation(({ method }) => rpcResult(method));
    requestCustomRPC.mockImplementation((_chain, method) => rpcResult(method));
  });

  test('derives slow, normal and fast EIP-1559 levels from RPC data', async () => {
    const levels = await new RpcGasService().getGasMarket({ chainServerId: 'eth' });

    expect(levels.map((level) => level.level)).toEqual([
      'slow',
      'normal',
      'fast',
      'custom',
    ]);
    expect(levels[0].price).toBeLessThan(levels[1].price);
    expect(levels[1].price).toBeLessThan(levels[2].price);
    expect(
      levels.slice(0, 3).every((level) => Number(level.base_fee) > 0)
    ).toBe(true);
    expect(
      requestDefaultRPC.mock.calls.map(([request]) => request.method)
    ).toEqual(
      expect.arrayContaining([
        'eth_feeHistory',
        'eth_maxPriorityFeePerGas',
        'eth_getBlockByNumber',
        'eth_gasPrice',
      ])
    );
  });

  test('falls back to selected-RPC legacy gasPrice when base fee is absent', async () => {
    requestDefaultRPC.mockImplementation(({ method }) => {
      if (method === 'eth_getBlockByNumber') return {};
      if (method === 'eth_gasPrice') return '0x4a817c800';
      if (method === 'eth_feeHistory') throw new Error('not supported');
      if (method === 'eth_maxPriorityFeePerGas') {
        throw new Error('not supported');
      }
      return undefined;
    });

    const levels = await new RpcGasService().getGasMarket({ chainServerId: 'eth' });
    expect(levels).toHaveLength(4);
    expect(
      levels.slice(0, 3).every((level) => level.base_fee == null)
    ).toBe(true);
    expect(levels[0].price).toBeLessThan(levels[2].price);
  });

  test('keeps custom RPC authoritative', async () => {
    hasCustomRPC.mockReturnValue(true);

    await new RpcGasService().getGasMarket({ chainServerId: 'eth' });

    expect(requestCustomRPC).toHaveBeenCalled();
    expect(requestDefaultRPC).not.toHaveBeenCalled();
  });

  test('adds a manual custom gas level without contacting a central API', async () => {
    const levels = await new RpcGasService().getGasMarket({
      chainServerId: 'eth',
      customGas: 42_000_000_000,
    });
    expect(levels.at(-1)).toMatchObject({
      level: 'custom',
      price: 42_000_000_000,
    });
  });
});
