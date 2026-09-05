import { OpenApiService } from '@rabby-wallet/rabby-api';
import { WebSignApiPlugin } from '@rabby-wallet/rabby-api/dist/plugins/web-sign';
import type { AxiosAdapter } from 'axios';

import fetchAdapter from './fetchAdapter';
import type { OpenapiClientStore } from './types';

/**
 * The background OpenAPI client must run every request through the forced
 * RemoteDataPolicy enforcement adapter (`rabbyOpenapiFetchAdapter`), so a
 * user-configured custom host is classified/blocked by policy exactly like a
 * canonical Rabby/DeBank endpoint. The plain default adapter is only correct
 * for clients whose requests are all policy-classified by URL, which is not
 * the case for the OpenAPI client (arbitrary `host` values).
 */
export const createOpenapiClient = (
  store: OpenapiClientStore,
  adapter: AxiosAdapter = fetchAdapter
) => {
  const openapi = new OpenApiService({
    plugin: WebSignApiPlugin,
    adapter,
    store,
  });
  return {
    openapi,
    init: () => openapi.init(),
  };
};

/**
 * Preserve the old namespace-proxy contract while making readiness an
 * implementation detail. Only methods are exposed to extension UI code.
 */
export const createReadyOpenapiProxy = <Client extends object>(
  client: Client,
  getReady: () => Promise<void>,
  afterCall?: () => Promise<void>
): Client =>
  new Proxy(
    {},
    {
      get(_target, method) {
        if (method === 'then') return undefined;
        return async (...params: unknown[]) => {
          await getReady();
          const target = client[method as keyof Client];
          if (typeof target !== 'function') {
            throw new Error(`Unknown OpenAPI method: ${String(method)}`);
          }
          const result = await Reflect.apply(target, client, params);
          await afterCall?.();
          return result;
        };
      },
    }
  ) as Client;
