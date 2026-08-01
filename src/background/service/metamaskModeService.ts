import { createPersistStore } from '../utils';
import permissionService from './permission';

interface MetamaskModeServiceStore {
  sites: string[];
  updatedAt: number;
}

class MetamaskModeService {
  store: MetamaskModeServiceStore = { sites: [], updatedAt: 0 };
  localSites: string[] = [];

  init = async () => {
    const storageCache = await createPersistStore<MetamaskModeServiceStore>({
      name: 'metamaskModeService',
      template: this.store,
    });
    this.store = storageCache || this.store;
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
