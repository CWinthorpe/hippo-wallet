import { EVENTS } from 'consts';

import eventBus from '@/eventBus';
import { getUITypeName } from '../utils/uiType';
import { createWallet } from './createWallet';

const walletClient = createWallet({
  name: getUITypeName(),
  onBroadcast(data) {
    eventBus.emit(data.type, data.data);
  },
});

// Hippo invariant: the OpenAPI client is constructed only in the background,
// where the RemoteDataPolicyService is initialized and consent-gated. UI
// windows route every openapi call through the background port instead of a
// local client whose process-local policy instance would be uninitialized
// (deny-by-default would break configured traffic, and a custom host would
// bypass classification entirely). The UI openapi store remains a read-only
// host mirror hydrated from the background snapshot.

eventBus.addEventListener(EVENTS.broadcastToBackground, (data) => {
  void walletClient.request({
    type: 'broadcast',
    method: data.method,
    params: data.data,
  });
});

export const wallet = walletClient.wallet;
export const walletReady = walletClient.ready;
export const walletRequest = walletClient.request;
export const onWalletReconnect = walletClient.onReconnect;
export const disposeWallet = () => {
  walletClient.dispose();
};

export { createWallet } from './createWallet';
export type { WalletMessageChannel, WalletRequest } from './createWallet';
