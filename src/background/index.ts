import eventBus from '@/eventBus';
import migrateData from '@/migrations';
import { getOriginFromUrl, transformFunctionsToZero } from '@/utils';
import { appIsDev } from '@/utils/env';

import { Message, sendReadyMessageToTabs } from '@/utils/message';
import Safe from '@rabby-wallet/gnosis-sdk';
import fetchAdapter from '@/services/openapi/fetchAdapter';
import { WalletController } from 'background/controller/wallet';
import {
  APPCHAIN_SYNC_SCENE,
  BALANCE_SYNC_SCENE,
  CACHE_VALID_DURATION,
  DEFI_SYNC_SCENE,
  NFT_SYNC_SCENE,
  TOKEN_SYNC_SCENE,
} from '@/db/constants';
import { syncDbService } from '@/db/services/syncDbService';
import {
  EVENTS,
  EVENTS_IN_BG,
  INTERNAL_REQUEST_ORIGIN,
  IS_FIREFOX,
} from 'consts';
import { ethErrors } from 'eth-rpc-errors';
import { isNull, omit, pick } from 'lodash';
import 'reflect-metadata';
import browser from 'webextension-polyfill';
import BigNumber from 'bignumber.js';
import { providerController, walletController } from './controller';
import createSubscription from './controller/provider/subscriptionManager';
import { dispatchRetainedNamespaceCall } from './service/openapiMethodAllowlist';
import {
  contactBookService,
  currencyService,
  HDKeyRingLastAddAddrTimeService,
  keyringService,
  openapiService,
  remoteDataPolicyService,
  pageStateCacheService,
  permissionService,
  preferenceService,
  RPCService,
  securityEngineService,
  sessionService,
  signTextHistoryService,
  transactionHistoryService,
  transactionWatchService,
  uninstalledService,
  whitelistService,
  OfflineChainsService,
  transactionsService,
  feedbackService,
} from './service';
import { customTestnetService } from './service/customTestnet';
import { initializeOpenapiStore } from './service/openapi';
import { syncChainService } from './service/syncChain';
import { userGuideService } from './service/userGuide';
import {
  BACKGROUND_READY_EVENT,
  BACKGROUND_READY_MESSAGE,
} from '@/utils/message/constants';
import rpcCache from './utils/rpcCache';
import { storage } from './webapi';
import { metamaskModeService } from './service/metamaskModeService';
import { subscribeTxCompleted } from './subscriptions/rateGuidance';

BigNumber.config({ EXPONENTIAL_AT: [-20, 100] });

Safe.adapter = fetchAdapter as any;
Safe.openapiService = openapiService;

const { PortMessage } = Message;

let appStoreLoaded = false;

async function restoreAppState() {
  // Determine the keyring session state from durable storage BEFORE any
  // service or migration may issue a Rabby/DeBank request. The remote-data
  // policy starts session-locked, so a locked wallet must never transiently
  // re-enable consent during worker startup.
  const keyringState = await storage.get('keyringState');
  keyringService.loadStore(keyringState);
  keyringService.store.subscribe((value) => storage.set('keyringState', value));
  keyringService.sanitizeUnencryptedKeyringDataInStore();

  await remoteDataPolicyService.init();
  await onInstall();
  // Consent is re-enabled only for a wallet that is already unlocked from
  // storage before the network-capable services and migrations start. For a
  // locked wallet the deny-by-default rules stay installed for the whole
  // boot; tryUnlock() below or the explicit unlock event re-applies consent.
  if (keyringService.isUnlocked()) {
    await remoteDataPolicyService.unlock();
  }
  await initializeOpenapiStore();
  await openapiService.init();

  // Init keyring and openapi first since this two service will not be migrated
  await migrateData();

  await customTestnetService.init();
  await permissionService.init();
  await preferenceService.init();
  await currencyService.init();
  await transactionWatchService.init();

  await pageStateCacheService.init();
  await transactionHistoryService.init();
  await contactBookService.init();
  await signTextHistoryService.init();
  await whitelistService.init();

  await RPCService.init();
  await securityEngineService.init();
  await HDKeyRingLastAddAddrTimeService.init();
  await uninstalledService.init();
  await metamaskModeService.init();
  await OfflineChainsService.init();
  await syncChainService.init();
  await transactionsService.init();
  await feedbackService.init();

  await walletController.tryUnlock();

  // Re-sync the session boundary after auto-unlock: consent is live only when
  // the wallet is unlocked (idempotent; for a locked wallet the deny-by-
  // default rules installed at init() remain in force).
  if (keyringService.isUnlocked()) {
    await remoteDataPolicyService.unlock();
  } else {
    await remoteDataPolicyService.lock();
  }

  rpcCache.start();

  appStoreLoaded = true;
  eventBus.emit(BACKGROUND_READY_EVENT);

  syncChainService.roll();
  transactionWatchService.roll();

  walletController.syncMainnetChainList();

  if (!keyringService.isBooted()) {
    userGuideService.init();
  }

  eventBus.addEventListener(EVENTS_IN_BG.ON_TX_COMPLETED, ({ address }) => {
    if (!address) return;

    walletController.forceExpireInMemoryAddressBalance(address);
    walletController.forceExpireInMemoryNetCurve(address);
    syncDbService.setUpdatedAtIfExists({
      address,
      scene: TOKEN_SYNC_SCENE,
      updatedAt: Date.now() - CACHE_VALID_DURATION,
    });
    syncDbService.setUpdatedAtIfExists({
      address,
      scene: DEFI_SYNC_SCENE,
      updatedAt: Date.now() - CACHE_VALID_DURATION,
    });
    syncDbService.setUpdatedAtIfExists({
      address,
      scene: APPCHAIN_SYNC_SCENE,
      updatedAt: Date.now() - CACHE_VALID_DURATION,
    });
    syncDbService.setUpdatedAtIfExists({
      address,
      scene: BALANCE_SYNC_SCENE,
      updatedAt: Date.now() - CACHE_VALID_DURATION,
    });
    syncDbService.setUpdatedAtIfExists({
      address,
      scene: NFT_SYNC_SCENE,
      updatedAt: Date.now() - CACHE_VALID_DURATION,
    });
  });

  if (appIsDev) {
    globalThis._forceExpireBalanceAboutData = (address: string) => {
      eventBus.emit(EVENTS_IN_BG.ON_TX_COMPLETED, { address });
    };
  }
  await sendReadyMessageToTabs();
  subscribeTxCompleted({ preferenceService });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'getBackgroundReady') return;
    // Only extension pages (popup/notification/desktop/tab) may learn that
    // the background is ready; content scripts and external tabs are ignored.
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) {
      return;
    }
    sendResponse({ data: { ready: true } });
  });

  uninstalledService.setUninstalled();
}

restoreAppState();
{
  keyringService.on('unlock', () => {
    walletController.syncMainnetChainList();
    contactBookService.detectWhiteListCex();
    // Unlock re-applies the user's saved remote-data consent.
    void remoteDataPolicyService.unlock();
  });
}

keyringService.on('resetPassword', () => {
  preferenceService.clearBiometricUnlockStorage();
});

// for page provider
browser.runtime.onConnect.addListener((port) => {
  if (
    port.name === 'popup' ||
    port.name === 'notification' ||
    port.name === 'tab' ||
    port.name === 'desktop'
  ) {
    const ownUrl = browser.runtime.getURL('/'); // chrome-extension://<id>/
    const senderUrl = port.sender?.url ?? '';
    // content-script: sender.tab 存在 且 url 不是扩展自身页面
    const isContentScript = !!port.sender?.tab && !senderUrl.startsWith(ownUrl);

    if (port.sender?.id !== browser.runtime.id || isContentScript) {
      port.disconnect();
      return;
    }
    const pm = new PortMessage(port);
    pm.listen((data) => {
      if (data?.type) {
        switch (data.type) {
          case 'broadcast':
            eventBus.emit(data.method, data.params);
            break;
          case 'openapi':
          case 'fakeTestnetOpenapi':
            // Deny-by-default allowlist dispatch (gpt56 B4): the whole
            // decision lives in dispatchRetainedNamespaceCall; a retired or
            // unlisted method fails with an explicit rejection naming it —
            // never dynamic "whatever exists" dispatch.
            return dispatchRetainedNamespaceCall(
              data.type,
              data.type === 'openapi'
                ? walletController.openapi
                : walletController.fakeTestnetOpenapi,
              data.method,
              data.params
            );
          case 'controller':
          default:
            if (data.method) {
              const controllerMethod = walletController[data.method];
              if (typeof controllerMethod !== 'function') {
                throw new Error(
                  `Unknown wallet controller method: ${String(data.method)}`
                );
              }
              const res = controllerMethod.call(null, ...data.params);
              if (!IS_FIREFOX) {
                return res;
              }
              if (typeof res?.then === 'function') {
                return res.then((x) => {
                  if (typeof x !== 'object' || isNull(x)) {
                    return x;
                  }
                  return transformFunctionsToZero(x);
                });
              }
              if (typeof res !== 'object' || isNull(res)) {
                return res;
              }
              return transformFunctionsToZero(res);
            }
        }
      }
    });

    const boardcastCallback = (data: any) => {
      pm.send('message', {
        event: 'broadcast',
        data: {
          type: data.method,
          data: data.params,
        },
      });
    };

    let activated = false;
    const activateUIConnection = () => {
      eventBus.removeEventListener(
        BACKGROUND_READY_EVENT,
        activateUIConnection
      );
      activated = true;
      eventBus.addEventListener(EVENTS.broadcastToUI, boardcastCallback);
      if (port.name === 'popup') {
        preferenceService.setPopupOpen(true);
      }
      feedbackService.setScreenshotContextMenuVisible(true).catch(() => {
        // Reset the native menu for newly opened extension pages.
      });
      browser.runtime.sendMessage({ type: 'pageOpened' });
      pm.send('message', { event: BACKGROUND_READY_MESSAGE });
    };
    if (appStoreLoaded) {
      activateUIConnection();
    } else {
      eventBus.addEventListener(BACKGROUND_READY_EVENT, activateUIConnection);
    }

    port.onDisconnect.addListener(() => {
      eventBus.removeEventListener(
        BACKGROUND_READY_EVENT,
        activateUIConnection
      );
      if (!activated) return;
      if (port.name === 'popup') {
        preferenceService.setPopupOpen(false);
      }
      browser.runtime.sendMessage({ type: 'pageClosed' });
      eventBus.removeEventListener(EVENTS.broadcastToUI, boardcastCallback);
    });

    return;
  }

  if (!port.sender?.tab) {
    return;
  }

  const pm = new PortMessage(port);
  const subscriptionManager = createSubscription(origin);

  subscriptionManager.events.on('notification', (message) => {
    pm.send('message', {
      event: 'message',
      data: {
        type: message.method,
        data: message.params,
      },
    });
    pm.send('message', {
      event: 'data',
      data: message,
    });
  });

  pm.listen(async (_data) => {
    if (!appStoreLoaded) {
      throw ethErrors.provider.disconnected();
    }

    const sessionId = port.sender?.tab?.id;
    if (sessionId === undefined || !port.sender?.url) {
      return;
    }
    const origin = getOriginFromUrl(port.sender.url);
    const session = sessionService.getOrCreateSession(sessionId, origin);

    let data = _data;
    if (origin !== INTERNAL_REQUEST_ORIGIN) {
      if (data?.$ctx?.providers?.length) {
        data.$ctx = pick(data.$ctx, 'providers');
      } else {
        data = omit(data, '$ctx');
      }
    }

    const req = {
      data,
      session,
      origin,
      sourceFrameId: port.sender.frameId,
    };
    if (!session?.origin) {
      const tabInfo = await browser.tabs.get(sessionId);
      // prevent tabCheckin not triggered, re-fetch tab info when session have no info at all
      session?.setProp({
        origin,
        name: tabInfo.title || '',
        icon: tabInfo.favIconUrl || '',
      });
    }
    // for background push to respective page
    req.session!.setPortMessage(pm);

    if (
      subscriptionManager.methods[data?.method] &&
      permissionService.getConnectedSite(session!.origin)?.isConnected
    ) {
      return subscriptionManager.methods[data.method].call(null, req);
    }

    return providerController(req);
  });

  port.onDisconnect.addListener((port) => {
    subscriptionManager.destroy();
  });
});

declare global {
  interface Window {
    wallet: WalletController;
  }
}

// On first install, open a new tab with Rabby
async function onInstall() {
  const storeAlreadyExisted = await userGuideService.isStorageExisted();
  // If the store doesn't exist, then this is the first time running this script,
  // and is therefore an install
  if (!storeAlreadyExisted) {
    await userGuideService.openUserGuide();
  }
}
