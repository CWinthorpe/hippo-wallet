import { useAccountStore } from '@/ui/state/account';
import { initializeContactBookStore } from '@/ui/state/contactBook';
import { initializeBizStores } from '@/ui/state/initializeBizStores';
import { initializePreferenceStore } from '@/ui/state/preference';

jest.mock('@/ui/state/account', () => ({
  useAccountStore: {
    getState: jest.fn(),
  },
}));

jest.mock('@/ui/state/contactBook', () => ({
  initializeContactBookStore: jest.fn(),
}));

jest.mock('@/ui/state/preference', () => ({
  initializePreferenceStore: jest.fn(),
}));

describe('initializeBizStores (Hippo reduced store set)', () => {
  test('initializes only preference, contact book, and account state', async () => {
    const account = {
      address: '0xabc',
      type: 'Simple Key Pair',
      brandName: 'Hippo Wallet',
    };
    const accountStore = {
      getCurrentAccountAsync: jest.fn().mockResolvedValue(account),
      onAccountChanged: jest.fn().mockResolvedValue(undefined),
      getSceneAccountMap: jest.fn().mockResolvedValue(undefined),
    };
    (useAccountStore.getState as jest.Mock).mockReturnValue(accountStore);
    (initializeContactBookStore as jest.Mock).mockResolvedValue(undefined);

    await initializeBizStores();

    expect(initializePreferenceStore).toHaveBeenCalledTimes(1);
    expect(initializeContactBookStore).toHaveBeenCalledTimes(1);
    expect(accountStore.getCurrentAccountAsync).toHaveBeenCalledTimes(1);
    expect(accountStore.onAccountChanged).toHaveBeenCalledWith('0xabc');
    expect(accountStore.getSceneAccountMap).toHaveBeenCalledTimes(1);
  });
});
