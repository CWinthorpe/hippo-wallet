import browser from 'webextension-polyfill';

const UPSTREAM_TRACKING_STORAGE_KEYS = [
  'UninstalledMetric',
  'clientId',
  'extensionId',
];

/** Compatibility service retained for existing call sites. */
class Uninstalled {
  init = async () => {
    try {
      await browser.storage.local.remove(UPSTREAM_TRACKING_STORAGE_KEYS);
      await browser.storage.session?.remove?.('sessionData');
    } catch (e) {
      // Older extension targets may not expose every storage area.
    }
    await this.setUninstalled();
  };

  syncStatus = async () => undefined;
  setImported = () => undefined;
  setWallet = () => undefined;
  setTx = () => undefined;
  setLocal = () => undefined;
  setWalletByKeyringType = (_keyringType: string) => undefined;

  setUninstalled = async () => {
    try {
      // Clear any URL persisted by an upstream installation. The private build
      // never reports wallet/import/transaction state during uninstall.
      await browser.runtime.setUninstallURL('');
    } catch (e) {
      // ignore
    }
  };
}

export default new Uninstalled();
