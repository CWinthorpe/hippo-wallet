import type { AccountActions, AccountState } from './state/account';
import { accountActions, useAccountStore } from './state/account';
import type {
  AccountToDisplayActions,
  AccountToDisplayState,
} from './state/accountToDisplay';
import {
  accountToDisplayActions,
  useAccountToDisplayStore,
} from './state/accountToDisplay';
import type {
  AddressManagementActions,
  AddressManagementState,
} from './state/addressManagement';
import {
  addressManagementActions,
  useAddressManagementStore,
} from './state/addressManagement';
import type { ChainsActions, ChainsState } from './state/chains';
import { chainsActions, useChainsStore } from './state/chains';
import { createSelectorStore } from './state/createStore/createSelectorStore';
import { initializeUIStore } from './state/initializeUIStore';
import type { PreferenceActions, PreferenceState } from './state/preference';
import { preferenceActions, usePreferenceStore } from './state/preference';

export type RabbyDispatch = {
  account: AccountActions;
  accountToDisplay: AccountToDisplayActions;
  addressManagement: AddressManagementActions;
  chains: ChainsActions;
  preference: PreferenceActions;
};

export type RabbyRootState = {
  account: AccountState;
  accountToDisplay: AccountToDisplayState;
  addressManagement: AddressManagementState;
  chains: ChainsState;
  preference: PreferenceState;
};

const rabbyDispatch: RabbyDispatch = {
  account: accountActions,
  accountToDisplay: accountToDisplayActions,
  addressManagement: addressManagementActions,
  chains: chainsActions,
  preference: preferenceActions,
};

initializeUIStore();

const useCombinedStore = createSelectorStore<RabbyRootState>()(() => ({
  account: useAccountStore.getState(),
  accountToDisplay: useAccountToDisplayStore.getState(),
  addressManagement: useAddressManagementStore.getState(),
  chains: useChainsStore.getState(),
  preference: usePreferenceStore.getState(),
}));

useAccountStore.subscribe((account) => {
  useCombinedStore.setState({ account });
});
useAccountToDisplayStore.subscribe((accountToDisplay) => {
  useCombinedStore.setState({ accountToDisplay });
});
useAddressManagementStore.subscribe((addressManagement) => {
  useCombinedStore.setState({ addressManagement });
});
useChainsStore.subscribe((chains) => {
  useCombinedStore.setState({ chains });
});
usePreferenceStore.subscribe((preference) => {
  useCombinedStore.setState({ preference });
});

/**
 * Compatibility helper for legacy call sites. The old `connect()` calls did
 * not select Redux state or consume an injected dispatch prop, so returning
 * the component directly preserves their behavior without a Redux Provider.
 */
export const connectStore = () => <Component>(component: Component) =>
  component;

export const useRabbyDispatch = () => rabbyDispatch;

export const useRabbySelector = <Selected>(
  selector: (state: RabbyRootState) => Selected
) => useCombinedStore(selector);
