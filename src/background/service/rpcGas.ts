import { GasLevel, Tx } from './openapi';
import RPCService from './rpc';
import { findChain } from '@/utils/chain';

const toBigInt = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^(0x[0-9a-f]+|\d+)$/i.test(value)) {
    throw new Error(`Selected RPC returned invalid ${label}`);
  }
  return BigInt(value);
};

const toSafeNumber = (value: bigint) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('RPC gas value exceeds the safe integer range');
  }
  return Number(value);
};

export class RpcGasService {
  private request = async (
    chainServerId: string,
    method: string,
    params: any[]
  ) => {
    const chain = findChain({ serverId: chainServerId });
    if (!chain) throw new Error('Unknown chain');
    if (RPCService.hasCustomRPC(chain.enum)) {
      return RPCService.requestCustomRPC(chain.enum, method, params);
    }
    return RPCService.requestDefaultRPC({
      chainServerId,
      method,
      params,
    });
  };

  getGasMarket = async ({
    chainServerId,
    tx,
    customGas,
  }: {
    chainServerId: string;
    tx?: Tx;
    customGas?: number;
  }): Promise<GasLevel[]> => {
    const [
      latestBlock,
      gasPriceRaw,
      priorityRaw,
      feeHistory,
    ] = await Promise.all([
      this.request(chainServerId, 'eth_getBlockByNumber', ['latest', false]),
      this.request(chainServerId, 'eth_gasPrice', []),
      this.request(chainServerId, 'eth_maxPriorityFeePerGas', []).catch(
        () => undefined
      ),
      this.request(chainServerId, 'eth_feeHistory', [
        '0x5',
        'latest',
        [10, 25, 50, 75, 90],
      ]).catch(() => undefined),
    ]);

    if (tx && !tx.gas && !tx.gasLimit) {
      await this.request(chainServerId, 'eth_estimateGas', [
        {
          from: tx.from,
          to: tx.to,
          data: tx.data || '0x',
          value: tx.value || '0x0',
        },
      ]);
    }

    const gasPrice = toBigInt(gasPriceRaw, 'gas price');
    const baseFeeRaw = latestBlock?.baseFeePerGas;
    const baseFee = baseFeeRaw ? toBigInt(baseFeeRaw, 'base fee') : undefined;

    let observedPriority: bigint | undefined;
    const rewards = Array.isArray(feeHistory?.reward)
      ? feeHistory.reward.flat().filter(Boolean)
      : [];
    if (rewards.length) {
      const values = rewards
        .map((value: string) => toBigInt(value, 'fee history reward'))
        .sort((a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0));
      observedPriority = values[Math.floor(values.length / 2)];
    }
    const rpcPriority = priorityRaw
      ? toBigInt(priorityRaw, 'priority fee')
      : undefined;
    const priority =
      rpcPriority ||
      observedPriority ||
      (baseFee && gasPrice > baseFee ? gasPrice - baseFee : 1n);

    const levels = baseFee
      ? [
          { level: 'slow', baseBps: 11_000n, priorityBps: 8_000n },
          { level: 'normal', baseBps: 12_000n, priorityBps: 10_000n },
          { level: 'fast', baseBps: 13_500n, priorityBps: 12_500n },
        ].map(({ level, baseBps, priorityBps }) => {
          const adjustedPriority = (priority * priorityBps) / 10_000n;
          const maxFee = (baseFee * baseBps) / 10_000n + adjustedPriority;
          return {
            level,
            price: toSafeNumber(maxFee),
            base_fee: toSafeNumber(baseFee),
            priority_price: toSafeNumber(adjustedPriority),
            front_tx_count: 0,
            estimated_seconds:
              level === 'slow' ? 45 : level === 'normal' ? 20 : 10,
          };
        })
      : [
          { level: 'slow', bps: 9_000n },
          { level: 'normal', bps: 10_000n },
          { level: 'fast', bps: 12_000n },
        ].map(({ level, bps }) => ({
          level,
          price: toSafeNumber((gasPrice * bps) / 10_000n || 1n),
          priority_price: 0,
          front_tx_count: 0,
          estimated_seconds:
            level === 'slow' ? 45 : level === 'normal' ? 20 : 10,
        }));

    return levels.concat([
      {
        level: 'custom',
        price: customGas || 0,
        priority_price: customGas || 0,
        front_tx_count: 0,
        estimated_seconds: 0,
      },
    ]) as GasLevel[];
  };
}

export default new RpcGasService();
