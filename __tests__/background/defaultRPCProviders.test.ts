import defaultChains from '@/constant/default-support-chains.json';
import providerConfiguration from '@/constant/default-rpc-providers.json';
import {
  getBuiltInDefaultRPCMap,
  getChainsRequiringCustomRPC,
} from '@/constant/default-rpc-providers';

const allowedHost = (provider: string, hostname: string) => {
  switch (provider) {
    case '1RPC':
      return hostname === 'public.1rpc.io';
    case 'dRPC':
      return hostname === 'drpc.org' || hostname.endsWith('.drpc.org');
    case 'PublicNode':
      return (
        hostname === 'publicnode.com' || hostname.endsWith('.publicnode.com')
      );
    case '0xRPC':
      return hostname === '0xrpc.io';
    default:
      return false;
  }
};

describe('bundled privacy RPC provider map', () => {
  test('matches every bundled chain and preserves the reviewed provider order', () => {
    const chainByServerId = new Map(
      defaultChains.map((chain) => [chain.id, chain])
    );
    const configuredRoutes = providerConfiguration.routes as Record<
      string,
      {
        chainId: number;
        endpoints: Array<{ provider: string; url: string }>;
      }
    >;

    expect(Object.keys(configuredRoutes)).toHaveLength(defaultChains.length);
    expect(providerConfiguration.providerOrder).toEqual([
      '1RPC',
      'dRPC',
      'PublicNode',
      '0xRPC',
    ]);

    for (const [serverId, route] of Object.entries(configuredRoutes)) {
      expect(chainByServerId.get(serverId)?.community_id).toBe(route.chainId);
      const providers = route.endpoints.map((endpoint) => endpoint.provider);
      const providerRanks = providers.map((provider) =>
        providerConfiguration.providerOrder.indexOf(provider)
      );
      expect(providerRanks).toEqual([...providerRanks].sort((a, b) => a - b));
      if (providers[0] === '1RPC') {
        expect(providers[1]).toBe('dRPC');
      }
    }
  });

  test('contains only credential-free HTTPS endpoints on approved provider hosts', () => {
    const configuredRoutes = providerConfiguration.routes as Record<
      string,
      { endpoints: Array<{ provider: string; url: string }> }
    >;

    for (const route of Object.values(configuredRoutes)) {
      expect(
        new Set(route.endpoints.map((endpoint) => endpoint.url)).size
      ).toBe(route.endpoints.length);
      for (const endpoint of route.endpoints) {
        const url = new URL(endpoint.url);
        expect(url.protocol).toBe('https:');
        expect(url.username).toBe('');
        expect(url.password).toBe('');
        expect(url.search).toBe('');
        expect(url.hash).toBe('');
        expect(allowedHost(endpoint.provider, url.hostname)).toBe(true);
      }
    }
  });

  test('ships 67 built-in routes and requires explicit custom RPCs for the rest', () => {
    expect(Object.keys(getBuiltInDefaultRPCMap())).toHaveLength(67);
    expect(getChainsRequiringCustomRPC()).toHaveLength(19);
    expect(providerConfiguration.routes.plasma.endpoints).toEqual([]);
  });
});
