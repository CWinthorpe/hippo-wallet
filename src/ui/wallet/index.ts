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

// Hippo: `wallet.openapi` stays a port-proxy onto the background service
// (createWallet's default 'openapi' namespace). Upstream #4035's UI-local
// OpenApiService client is intentionally NOT used: the remote-data consent
// policy singleton, the forced-policy fetch adapter, the null API-key store,
// and the disabled Rabby RPC control plane all live in the background
// context. A second client in each extension page would bypass them.

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
export const disposeWallet = walletClient.dispose;

export { createWallet } from './createWallet';
export type { WalletMessageChannel, WalletRequest } from './createWallet';
