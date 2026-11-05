import { CHAINS, CHAINS_ENUM } from 'consts';
import { createPersistStore } from '../utils';
import { permissionService, sessionService } from '.';

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

  /**
   * Disconnect the dapps whose chain was removed from the chain list. They are
   * told directly, as the permission check already filters them out of
   * broadcasts.
   *
   * Upstream (#4224) calls this after a remote chain-list sync, which Hippo
   * intentionally does not perform; live callers are the startup permission
   * bootstrap and custom-network removal in wallet.ts.
   */
  disconnectSitesWithUnsupportedChain = () => {
    const ethChain = CHAINS[CHAINS_ENUM.ETH];
    permissionService
      .resetSitesWithUnsupportedChain()
      .filter((site) => site.isConnected)
      .forEach((site) => {
        sessionService.broadcastEvent('accountsChanged', [], site.origin, true);
        sessionService.broadcastEvent(
          'chainChanged',
          {
            chain: ethChain.hex,
            networkVersion: ethChain.network,
          },
          site.origin,
          true
        );
      });
  };

  resetTimer = () => undefined;

  roll = () => undefined;
}

export const syncChainService = new SyncChainService();
