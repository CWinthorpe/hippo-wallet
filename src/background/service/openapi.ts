import { INITIAL_OPENAPI_URL } from '@/constant';
import {
  createOpenapiRuntime,
  createOpenapiStoreTemplate,
  OpenapiServiceStore,
  openapiStoreSchema,
} from '@/services/openapi';
import type { PublicOpenapiStore } from '@/services/openapi';
import { OpenApiService } from '@rabby-wallet/rabby-api';
import { createPersistStore, patchPersistStore } from 'background/utils';

export * from '@/services/openapi';

/**
 * Hippo: the api.rabby.io client always runs through the force-policy fetch
 * adapter so remote-data consent gates every Rabby/DeBank request, and no
 * persistent installation identifier is ever attached (see OpenapiStore
 * below). PUBLIC_OPENAPI_KEYS is re-declared here rather than imported from
 * '@/services/openapi/types' to keep apiKey out of the UI-shared half.
 */
export const HIPPO_PUBLIC_OPENAPI_KEYS = ['host'] as const;

// Hippo narrows the UI-shared half to `host`: apiKey/apiTime never leave the
// background (no persistent installation identifier is ever generated).
export type HippoPublicOpenapiStore = Pick<
  OpenapiServiceStore,
  typeof HIPPO_PUBLIC_OPENAPI_KEYS[number]
>;

const pickPublicOpenapiStore = (
  store: Partial<OpenapiServiceStore>
): HippoPublicOpenapiStore =>
  Object.fromEntries(
    Object.entries(store).filter(([key]) =>
      (HIPPO_PUBLIC_OPENAPI_KEYS as readonly string[]).includes(key)
    )
  ) as HippoPublicOpenapiStore;

class HippoOpenapiStore {
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
      broadcastKeys: HIPPO_PUBLIC_OPENAPI_KEYS,
    });
    // Remove the legacy endpoint after upgrading from builds that persisted a
    // separate testnet OpenAPI client. Unknown schema keys are otherwise kept
    // by the generic persistence layer to support downgrades.
    Reflect.deleteProperty(this.store, 'testnetHost');
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
}

const proxyStore = new HippoOpenapiStore();

if (!process.env.DEBUG) {
  proxyStore.host = INITIAL_OPENAPI_URL;
}

const openapiRuntime = createOpenapiRuntime({
  kind: 'background',
  store: proxyStore,
  initializeStore: proxyStore.init,
});
const service = openapiRuntime.openapi;

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
disableActionLogging(service);

export const initializeOpenapiStore = () => proxyStore.init();
export const initializeOpenapiRuntime = () => openapiRuntime.ready;

export const getOpenapiStore = (): HippoPublicOpenapiStore =>
  pickPublicOpenapiStore(proxyStore.getStore());

export const patchOpenapiStore = async (
  partials: Partial<PublicOpenapiStore> | HippoPublicOpenapiStore
) => {
  // Reachable from the UI through `setStorageItem`, so drop anything outside
  // the public half instead of trusting the caller's typing.
  proxyStore.patchStore(pickPublicOpenapiStore(partials));

  // Keep the background request headers aligned with identity changes coming
  // from any UI runtime.
  if (
    HIPPO_PUBLIC_OPENAPI_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(partials, key)
    )
  ) {
    await openapiRuntime.reconfigure();
  }
};

export default service;
