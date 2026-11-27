import { createPersistStore } from '../utils';
import permissionService from './permission';

interface MetamaskModeServiceStore {
  sites: string[];
  updatedAt: number;
}

const isSiteList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
class MetamaskModeService {
  store: MetamaskModeServiceStore = { sites: [], updatedAt: 0 };
  localSites: string[] = [];

  init = async () => {
    const storageCache = await createPersistStore<MetamaskModeServiceStore>({
      name: 'metamaskModeService',
      template: this.store,
    });
    this.store = storageCache || this.store;
    // Upstream #4345 corrupt-store guard. Hippo removed the remote
    // fake_mm_dapps fetch entirely, so the list is validated once on init
    // and only local sources feed checkIsMetamaskMode.
    if (!isSiteList(this.store.sites)) {
      this.store.sites = [];
      this.store.updatedAt = 0;
    }
    this.localSites = permissionService
      .getMetamaskModeSites()
      .map((item) => item.origin.replace(/^https?:\/\//, ''));
  };

  syncMetamaskModeList = async () => this.store.sites;

  checkIsMetamaskMode(origin: string) {
    return [...this.store.sites, ...this.localSites].some(
      (item) => item === origin.replace(/^https?:\/\//, '')
    );
  }
}

export const metamaskModeService = new MetamaskModeService();
