import { createPersistStore } from '../utils';

interface SyncChainServiceStore {
  updatedAt: number;
}

class SyncChainService {
  store: SyncChainServiceStore = {
    updatedAt: 0,
  };

  init = async () => {
    const storage = await createPersistStore<SyncChainServiceStore>({
      name: 'supported_chains',
      template: {
        updatedAt: 0,
      },
    });
    this.store = storage || this.store;
    this.store.updatedAt = this.store.updatedAt || 0;
  };

  /**
   * Hippo ships its reviewed chain inventory with the extension. Keeping this
   * compatibility method avoids migration breakage without contacting
   * static.debank.com or Rabby's supported-chain endpoint.
   */
  syncMainnetChainList = async (_options?: { force?: boolean }) => {
    this.store.updatedAt = Date.now();
  };

  resetTimer = () => undefined;

  roll = () => undefined;
}

export const syncChainService = new SyncChainService();
