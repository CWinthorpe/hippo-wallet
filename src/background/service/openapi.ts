import { INITIAL_OPENAPI_URL } from '@/constant';
import {
  createOpenapiRuntime,
  createOpenapiStoreTemplate,
  OpenapiServiceStore,
  openapiStoreSchema,
  pickPublicOpenapiStore,
  PUBLIC_OPENAPI_KEYS,
  PublicOpenapiStore,
} from '@/services/openapi';
import { createPersistStore, patchPersistStore } from 'background/utils';
import { rabbyOpenapiFetchAdapter } from '@/services/openapi/fetchAdapter';

export * from '@/services/openapi';

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
    // Remove legacy endpoint fields after upgrading from builds that persisted
    // a separate testnet OpenAPI client. Unknown schema keys are otherwise
    // kept by the generic persistence layer to support downgrades.
    Reflect.deleteProperty(this.store, 'testnetHost');
    this.initialized = true;
    // Hippo privacy policy: never generate or keep a persistent installation
    // identifier. Public endpoints remain signed by WebSignApiPlugin only.
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
    this.store.apiKey = null;
    this.store.apiTime = null;
  }
}

const proxyStore = new OpenapiStore();

if (!process.env.DEBUG) {
  proxyStore.host = INITIAL_OPENAPI_URL;
}

const openapiRuntime = createOpenapiRuntime({
  kind: 'background',
  store: proxyStore,
  initializeStore: proxyStore.init,
  // Forced policy enforcement: every background OpenAPI request (including a
  // user-configured custom host) must pass RemoteDataPolicy classification.
  clientAdapter: rabbyOpenapiFetchAdapter,
});
const service = openapiRuntime.openapi;

const disabledRabbyRPCError = () =>
  Object.assign(
    new Error('Rabby RPC control plane is disabled; use Hippo RPC routing'),
    { code: 'RABBY_RPC_DISABLED' }
  );

const disableRabbyRPCControlPlane = (client: typeof service) => {
  client.getDefaultRPCs = async () => {
    throw disabledRabbyRPCError();
  };
  client.ethRpc = async () => {
    throw disabledRabbyRPCError();
  };
};

const disableActionLogging = (client: typeof service) => {
  client.postActionLog = async () => undefined;
};

disableRabbyRPCControlPlane(service);
disableActionLogging(service);

export const initializeOpenapiStore = () => proxyStore.init();
export const initializeOpenapiRuntime = () => openapiRuntime.ready;

export const getOpenapiStore = (): PublicOpenapiStore =>
  pickPublicOpenapiStore(proxyStore.getStore());

export const patchOpenapiStore = async (
  partials: Partial<PublicOpenapiStore>
) => {
  // Reachable from the UI through `setStorageItem`, so drop anything outside
  // the public half instead of trusting the caller's typing.
  proxyStore.patchStore(pickPublicOpenapiStore(partials));

  if (
    PUBLIC_OPENAPI_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(partials, key)
    )
  ) {
    await openapiRuntime.reconfigure();
  }
};

export default service;
