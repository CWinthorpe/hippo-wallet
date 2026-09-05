import { useAccountStore } from '@/ui/state/account';
import { initializeContactBookStore } from '@/ui/state/contactBook';
import { initializePreferenceStore } from '@/ui/state/preference';

/** Initializes UI business stores after the wallet status is available. */
export const initializeBizStores = () => {
  const accountInitialization = (async () => {
    const accountStore = useAccountStore.getState();
    const account = await accountStore.getCurrentAccountAsync();
    await accountStore.onAccountChanged(account?.address);
    await accountStore.getSceneAccountMap();
  })();

  void initializePreferenceStore();
  void initializeContactBookStore().catch(() => undefined);

  return accountInitialization;
};
