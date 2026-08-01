import { INITIAL_OPENAPI_URL, INITIAL_TESTNET_OPENAPI_URL } from '@/constant';
import { OpenApiService } from '@rabby-wallet/rabby-api';
import { createPersistStore } from 'background/utils';
export * from '@rabby-wallet/rabby-api/dist/types';
import { WebSignApiPlugin } from '@rabby-wallet/rabby-api/dist/plugins/web-sign';
import fetchAdapter from 'background/utils/fetchAdapter';

class baseStore {
  store: {
    host: string;
    testnetHost: string;
    apiKey: string | null;
    apiTime: number | null;
  };

  constructor() {
    this.store = {
      host: INITIAL_OPENAPI_URL,
      testnetHost: INITIAL_TESTNET_OPENAPI_URL,
      apiKey: null,
      apiTime: null,
    };
    this.store.apiKey = null;
    this.store.apiTime = null;
    createPersistStore({
      name: 'openapi',
      template: {
        host: INITIAL_OPENAPI_URL,
        testnetHost: INITIAL_TESTNET_OPENAPI_URL,
        apiKey: null,
        apiTime: null,
      },
    }).then((res) => {
      this.store = res;
      // Do not attach a persistent installation identifier to functional API
      // traffic. Public endpoints remain signed by WebSignApiPlugin.
      this.store.apiKey = null;
      this.store.apiTime = null;
    });
  }

  get host() {
    return this.store.host;
  }

  set host(value: string) {
    this.store.host = value;
  }

  get testnetHost() {
    return this.store.testnetHost;
  }

  set testnetHost(value: string) {
    this.store.testnetHost = value;
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

const testnetStore = new (class TestnetStore extends baseStore {
  constructor() {
    super();
  }
  get host() {
    return this.store.testnetHost;
  }
  set host(value: string) {
    this.store.testnetHost = value;
  }
})();

const proxyStore = new baseStore();

if (!process.env.DEBUG) {
  proxyStore.host = INITIAL_OPENAPI_URL;
  proxyStore.testnetHost = INITIAL_TESTNET_OPENAPI_URL;
  testnetStore.host = INITIAL_TESTNET_OPENAPI_URL;
  testnetStore.testnetHost = INITIAL_TESTNET_OPENAPI_URL;
}

const service = new OpenApiService({
  plugin: WebSignApiPlugin,
  adapter: fetchAdapter,
  store: proxyStore,
});

if (typeof window !== 'undefined') {
  service.initSync();
}

export const testnetOpenapiService = new OpenApiService({
  plugin: WebSignApiPlugin,
  adapter: fetchAdapter,
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

export default service;
