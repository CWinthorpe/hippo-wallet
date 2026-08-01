import providerConfiguration from './default-rpc-providers.json';

export type BuiltInRPCProvider = '1RPC' | 'dRPC' | 'PublicNode' | '0xRPC';

export interface BuiltInRPCEndpoint {
  provider: BuiltInRPCProvider;
  url: string;
}

export interface BuiltInRPCRoute {
  chainId: number;
  name: string;
  endpoints: BuiltInRPCEndpoint[];
}

export interface BuiltInDefaultRPC {
  chainId: string;
  rpcUrl: string[];
  txPushToRPC: true;
}

const configuredRoutes = providerConfiguration.routes as Record<
  string,
  BuiltInRPCRoute
>;

export const BUILT_IN_RPC_PROVIDER_ORDER = providerConfiguration.providerOrder as BuiltInRPCProvider[];
export const BUILT_IN_RPC_REVIEWED_AT = providerConfiguration.reviewedAt;

export const getBuiltInDefaultRPCMap = (): Record<string, BuiltInDefaultRPC> =>
  Object.entries(configuredRoutes).reduce<Record<string, BuiltInDefaultRPC>>(
    (result, [serverId, route]) => {
      const rpcUrl = route.endpoints.map((endpoint) => endpoint.url);
      if (rpcUrl.length) {
        result[serverId] = {
          chainId: serverId,
          rpcUrl,
          txPushToRPC: true,
        };
      }
      return result;
    },
    {}
  );

export const getBuiltInRPCRoute = (
  chainServerId: string
): BuiltInRPCRoute | undefined => configuredRoutes[chainServerId];

export const getChainsRequiringCustomRPC = () =>
  Object.entries(configuredRoutes)
    .filter(([, route]) => route.endpoints.length === 0)
    .map(([serverId, route]) => ({
      serverId,
      chainId: route.chainId,
      name: route.name,
    }));
