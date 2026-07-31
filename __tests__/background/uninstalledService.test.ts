/**
 * @jest-environment jsdom
 */

jest.mock('webextension-polyfill', () => ({
  storage: {
    local: { remove: jest.fn() },
    session: { remove: jest.fn() },
  },
  runtime: { setUninstallURL: jest.fn() },
}));

import browser from 'webextension-polyfill';
import uninstalledService from '@/background/service/uninstalled';

const localRemove = browser.storage.local.remove as jest.Mock;
const sessionRemove = browser.storage.session.remove as jest.Mock;
const setUninstallURL = browser.runtime.setUninstallURL as jest.Mock;

describe('private-build uninstall compatibility service', () => {
  beforeEach(() => {
    localRemove.mockReset().mockResolvedValue(undefined);
    sessionRemove.mockReset().mockResolvedValue(undefined);
    setUninstallURL.mockReset().mockResolvedValue(undefined);
  });

  test('deletes upstream identifiers and clears the uninstall URL', async () => {
    await uninstalledService.init();

    expect(localRemove).toHaveBeenCalledWith([
      'UninstalledMetric',
      'clientId',
      'extensionId',
    ]);
    expect(sessionRemove).toHaveBeenCalledWith('sessionData');
    expect(setUninstallURL).toHaveBeenCalledWith('');
  });

  test('retains call-site methods as local no-ops', async () => {
    uninstalledService.setImported();
    uninstalledService.setWallet();
    uninstalledService.setTx();
    uninstalledService.setLocal();
    uninstalledService.setWalletByKeyringType('anything');
    await uninstalledService.syncStatus();

    expect(localRemove).not.toHaveBeenCalled();
    expect(setUninstallURL).not.toHaveBeenCalled();
  });
});
