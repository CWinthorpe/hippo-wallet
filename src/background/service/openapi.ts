import { INITIAL_OPENAPI_URL, INITIAL_TESTNET_OPENAPI_URL } from '@/constant';
import { OpenApiService } from '@rabby-wallet/rabby-api';
import { createPersistStore, patchPersistStore } from 'background/utils';
export * from '@rabby-wallet/rabby-api/dist/types';
import { WebSignApiPlugin } from '@rabby-wallet/rabby-api/dist/plugins/web-sign';
import { rabbyOpenapiFetchAdapter } from 'background/utils/fetchAdapter';
import { z } from 'zod';

const openapiStoreSchema = z.object({
  host: z.string().default(INITIAL_OPENAPI_URL),
  testnetHost: z.string().default(INITIAL_TESTNET_OPENAPI_URL),
  apiKey: z.string().nullable().default(null),
  apiTime: z.number().nullable().default(null),
});

export type OpenapiServiceStore = z.output<typeof openapiStoreSchema>;

/**
 * The half of the openapi store the UI is allowed to hold. `apiKey` is the
 * X-API-Key header on every api.rabby.io request, so it stays in the
 * background rather than being copied into each extension page.
 *
 * Hippo additionally never generates a key at all: public endpoints remain
 * signed by WebSignApiPlugin and no persistent installation identifier is
 * attached to functional API traffic.
 */
export const PUBLIC_OPENAPI_KEYS = ['host', 'testnetHost'] as const;

export type PublicOpenapiStore = Pick<
  OpenapiServiceStore,
  typeof PUBLIC_OPENAPI_KEYS[number]
>;

const pickPublicOpenapiStore = <T extends Partial<OpenapiServiceStore>>(
  store: T
): Pick<T, typeof PUBLIC_OPENAPI_KEYS[number] & keyof T> =>
  Object.fromEntries(
    Object.entries(store).filter(([key]) =>
      (PUBLIC_OPENAPI_KEYS as ReadonlyArray<string>).includes(key)
    )
  ) as Pick<T, typeof PUBLIC_OPENAPI_KEYS[number] & keyof T>;

const createOpenapiStoreTemplate = (): OpenapiServiceStore =>
  openapiStoreSchema.parse({});

class OpenapiStore {
  store: OpenapiServiceStore = createOpenapiStoreTemplate();
  private initialized = false;
  private initialization: Promise<void>;

  constructor() {
    this.initialization = this.initialize();
  }

  private initialize = async () => {
    this.store = await createPersistStore<OpenapiServiceStore>({
      name: 'openapi',
      template: createOpenapiStoreTemplate(),
      schema: openapiStoreSchema,
      broadcastKeys: PUBLIC_OPENAPI_KEYS,
    });
    this.initialized = true;
    // Do not attach a persistent installation identifier to functional API
    // traffic. Public endpoints remain signed by WebSignApiPlugin.
    this.store.apiKey = null;
    this.store.apiTime = null;
  };

  init = () => this.initialization;

  getStore = () => this.store;

  patchStore = (partials: Partial<OpenapiServiceStore>) => {
    if (!this.initialized) {
      Object.assign(this.store, partials);
      return;
    }
    patchPersistStore(this.store, partials);
  };

  get host() {
    return this.store.host;
  }

  set host(value: string) {
    this.patchStore({ host: value });
  }

  get testnetHost() {
    return this.store.testnetHost;
  }

  set testnetHost(value: string) {
    this.patchStore({ testnetHost: value });
  }

  get apiKey() {
    return this.store.apiKey;
  }

  set apiKey(_value: string | null) {
    this.store.apiKey = null;
    this.store.apiTime = null;
  }

  get apiTime() {
    return this.store.apiTime;
  }

  set apiTime(_value: number | null) {
    this.store.apiTime = null;
  }

  generateAPIKey = () => {
    // Hippo: no API key is ever generated for functional API traffic.
    this.store.apiKey = null;
    this.store.apiTime = null;
  };
}

const proxyStore = new OpenapiStore();

const testnetStore = {
  get host() {
    return proxyStore.testnetHost;
  },
  set host(value: string) {
    proxyStore.testnetHost = value;
  },
  get testnetHost() {
    return proxyStore.testnetHost;
  },
  set testnetHost(value: string) {
    proxyStore.testnetHost = value;
  },
  get apiKey() {
    return proxyStore.apiKey;
  },
  set apiKey(value: string | null) {
    proxyStore.apiKey = value;
  },
  get apiTime() {
    return proxyStore.apiTime;
  },
  set apiTime(value: number | null) {
    proxyStore.apiTime = value;
  },
};

if (!process.env.DEBUG) {
  proxyStore.host = INITIAL_OPENAPI_URL;
  proxyStore.testnetHost = INITIAL_TESTNET_OPENAPI_URL;
}

const service = new OpenApiService({
  plugin: WebSignApiPlugin,
  adapter: rabbyOpenapiFetchAdapter,
  store: proxyStore,
});

if (typeof window !== 'undefined') {
  service.initSync();
}

export const testnetOpenapiService = new OpenApiService({
  plugin: WebSignApiPlugin,
  adapter: rabbyOpenapiFetchAdapter,
  store: testnetStore,
});

const disabledRabbyRPCError = () =>
  Object.assign(
    new Error('Rabby RPC control plane is disabled; use Hippo RPC routing'),
    { code: 'RABBY_RPC_DISABLED' }
  );

const disableRabbyRPCControlPlane = (client: OpenApiService) => {
  client.getDefaultRPCs = async () => {
    throw disabledRabbyRPCError();
  };
  client.ethRpc = async () => {
    throw disabledRabbyRPCError();
  };
};

const disableActionLogging = (client: OpenApiService) => {
  client.postActionLog = async () => undefined;
};

disableRabbyRPCControlPlane(service);
disableRabbyRPCControlPlane(testnetOpenapiService);
disableActionLogging(service);
disableActionLogging(testnetOpenapiService);

export const initializeOpenapiStore = () => proxyStore.init();

export const getOpenapiStore = (): PublicOpenapiStore =>
  pickPublicOpenapiStore(proxyStore.getStore());

export const patchOpenapiStore = async (
  partials: Partial<PublicOpenapiStore>
) => {
  // Reachable from the UI through `setStorageItem`, so drop anything outside
  // the public half instead of trusting the caller's typing.
  proxyStore.patchStore(pickPublicOpenapiStore(partials));

  const initializations: Promise<void>[] = [];
  if (Object.prototype.hasOwnProperty.call(partials, 'host')) {
    initializations.push(service.init());
  }
  if (Object.prototype.hasOwnProperty.call(partials, 'testnetHost')) {
    initializations.push(testnetOpenapiService.init());
  }
  await Promise.all(initializations);
};

export default service;
