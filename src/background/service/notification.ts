import browser, { Windows } from 'webextension-polyfill';
import Events from 'events';
import { ethErrors } from 'eth-rpc-errors';
import { v4 as uuidv4 } from 'uuid';
import * as Sentry from '@sentry/browser';
import { EthereumProviderError } from 'eth-rpc-errors/dist/classes';
import { winMgr } from 'background/webapi';
import {
  KEYRING_CATEGORY_MAP,
  IS_LINUX,
  IS_VIVALDI,
  IS_CHROME,
  KEYRING_CATEGORY,
  IS_WINDOWS,
} from 'consts';
import transactionHistoryService from './transactionHistory';
import preferenceService, { Account } from './preference';
import stats from '@/stats';
import { findChain } from '@/utils/chain';
import { isManifestV3 } from '@/utils/env';

type IApprovalComponents = typeof import('@/ui/views/Approval/components');
type IApprovalComponent = IApprovalComponents[keyof IApprovalComponents];

export interface Approval {
  id: string;
  /** Lifecycle generation at creation time; see `approvalEpoch`. */
  approvedEpoch: number;
  taskId: number | null;
  signingTxId?: string;
  data: {
    params?: import('react').ComponentProps<IApprovalComponent>['params'];
    account: Account;
    origin?: string;
    approvalComponent: keyof IApprovalComponents;
    requestDefer?: Promise<any>;
    approvalType?: string;
  };
  winProps: any;
  resolve?(params?: any): void;
  reject?(err: EthereumProviderError<any>): void;
}

// gpt56 round-9 blocker 5: 'Unlock' was upstream-queued for concurrency, but
// Hippo has no Unlock renderer inside /approval and the second queued Unlock
// can never render after the first unlock resolves the wallet — a stranded
// request and blank notification window. Membership means coexistence-safe;
// Unlock is not, so it is removed. Locked origins now get an explicit
// rejection while another Unlock is pending (retry after unlock), and the
// same-origin guard in rpcFlow is unchanged.
const QUEUE_APPROVAL_COMPONENTS_WHITELIST = [
  'SignTx',
  'SignText',
  'SignTypedData',
  'LedgerHardwareWaiting',
  'QRHardWareWaiting',
  'WatchAddressWaiting',
  'CommonWaiting',
  'PrivatekeyWaiting',
  'CoinbaseWaiting',
  'ImKeyHardwareWaiting',
];

export type StatsData = {
  signed: boolean;
  signedSuccess: boolean;
  submit: boolean;
  submitSuccess: boolean;
  type: string;
  chainId: string;
  category: KEYRING_CATEGORY;
  preExecSuccess: boolean;
  createdBy: string;
  source: any;
  trigger: any;
  reported: boolean;
  signMethod?: string;
  networkType?: string;
};

// something need user approval in window
// should only open one window, unfocus will close the current notification
class NotificationService extends Events {
  currentApproval: Approval | null = null;
  /**
   * Lifecycle generation for approvals. Bumped on session boundaries (lock,
   * window teardown): approvals created in an earlier generation can never be
   * resolved/rejected afterwards, so a pre-boundary async continuation cannot
   * finish the request after the session changed.
   */
  approvalEpoch = 0;
  bumpApprovalEpoch = () => {
    this.approvalEpoch += 1;
  };
  /**
   * Per-origin lifecycle generation for dApp-driven authority transitions
   * (site-account reassignment, chain switch, disconnect). These boundaries
   * must invalidate an already-resolved-but-unexecuted request for THAT
   * origin only, without disturbing other origins' queued approvals, so they
   * bump this map instead of the global epoch. rpcFlow captures the value at
   * approval-queue time and rechecks it sink-adjacent.
   */
  originApprovalEpoch = new Map<string, number>();
  bumpOriginApprovalEpoch = (origin: string) => {
    if (!origin) return;
    this.originApprovalEpoch.set(
      origin,
      this.getOriginApprovalEpoch(origin) + 1
    );
  };
  getOriginApprovalEpoch = (origin: string): number =>
    this.originApprovalEpoch.get(origin) ?? 0;
  dappManager = new Map<
    string,
    {
      lastRejectTimestamp: number;
      lastRejectCount: number;
      blockedTimestamp: number;
      isBlocked: boolean;
    }
  >();
  _approvals: Approval[] = [];
  notifiWindowId: null | number = null;
  isLocked = false;
  currentRequestDeferFn?: (retry?: boolean) => void;
  /** Parent approval id owning currentRequestDeferFn (teardown binding). */
  currentRequestDeferOwnerApprovalId?: string;
  statsData: StatsData | undefined;

  get approvals() {
    return this._approvals;
  }

  set approvals(val: Approval[]) {
    this._approvals = val;
    const action = isManifestV3 ? browser.action : browser.browserAction;

    if (val.length <= 0) {
      action.setBadgeText({
        text: isManifestV3 ? '' : null,
      });
    } else {
      action.setBadgeText({
        text: val.length + '',
      });
      action.setBadgeBackgroundColor({
        color: '#FE815F',
      });
    }
  }

  constructor() {
    super();

    winMgr.event.on('closeNotification', (closedWinId?: number) => {
      // The token-bound handler only reports the window the nonce was minted
      // for; ignore anything that does not match the live notification
      // window so a stale or unrelated close cannot drop the tracked id.
      if (closedWinId !== undefined && closedWinId !== this.notifiWindowId) {
        return;
      }
      this.notifiWindowId = null;
    });

    winMgr.event.on(
      'windowRemoved',
      (winId: number, isManuallyClosed: boolean) => {
        if (winId === this.notifiWindowId) {
          this.notifiWindowId = null;
          if (isManuallyClosed) {
            this.rejectAllApprovals();
          }
        }
      }
    );

    winMgr.event.on('windowFocusChange', (winId: number) => {
      if (IS_VIVALDI || IS_LINUX) return;
      if (IS_CHROME && winId === browser.windows.WINDOW_ID_NONE && IS_WINDOWS) {
        // When sign on Linux or Windows, will focus on -1 first then focus on sign window
        return;
      }

      if (this.notifiWindowId !== null && winId !== this.notifiWindowId) {
        if (
          this.currentApproval &&
          !QUEUE_APPROVAL_COMPONENTS_WHITELIST.includes(
            this.currentApproval.data.approvalComponent
          )
        ) {
          this.rejectApproval(
            undefined,
            false,
            false,
            this.currentApproval?.id,
            this.currentApproval?.data?.approvalComponent
          );
        }
      }
    });
  }

  activeFirstApproval = async () => {
    try {
      const windows = await browser.windows.getAll();
      const existWindow = windows.find(
        (window) => window.id === this.notifiWindowId
      );
      if (this.notifiWindowId !== null && !!existWindow) {
        browser.windows.update(this.notifiWindowId, {
          focused: true,
        });
        return;
      }

      if (this.approvals.length <= 0) return;

      const approval = this.approvals[0];
      this.currentApproval = approval;
      this.openNotification(approval.winProps, true);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { function: 'activeFirstApproval' },
      });
      this.clear();
    }
  };

  deleteApproval = (approval) => {
    if (approval && this.approvals.length > 1) {
      this.approvals = this.approvals.filter((item) => approval.id !== item.id);
    } else {
      this.currentApproval = null;
      this.approvals = [];
    }
  };

  getApproval = () => this.currentApproval;

  resolveApproval = async (
    data?: any,
    forceReject = false,
    approvalId?: string,
    approvalComponent?: string
  ) => {
    // Approval identity is mandatory: an approval may only be resolved by
    // the exact id AND component that rendered it, at its lifecycle epoch.
    // Without a matching id/component (or after the epoch bumped on
    // lock/session teardown) this is a no-op, never a blind resolve of
    // whatever is current (gpt56 round-10 blocker 3).
    if (
      !approvalId ||
      approvalId !== this.currentApproval?.id ||
      !approvalComponent ||
      approvalComponent !== this.currentApproval?.data?.approvalComponent ||
      (this.currentApproval as { approvedEpoch?: number })?.approvedEpoch !==
        this.approvalEpoch
    ) {
      return;
    }
    if (forceReject) {
      this.revokeSigningOperation(this.currentApproval);
      this.currentApproval?.reject &&
        this.currentApproval?.reject(
          new EthereumProviderError(4001, 'User Cancel')
        );
    } else {
      // Lineage for the SIGN_WAITING handshake is derived EXCLUSIVELY from
      // background-owned approval state (gpt56 round-10 blocker 3): reserved
      // __* fields arriving in UI-supplied data are stripped, so a stale or
      // confused extension context can never forge a parent binding. A
      // waiting child inherits the parent tuple from its own params (placed
      // there by the background resolve below); the parent attaches its own.
      const approvalParams: any =
        (this.currentApproval.data as any)?.params || {};
      const cleanData =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (() => {
              const copy = { ...(data as Record<string, unknown>) };
              delete copy.__approvalId;
              delete copy.__approvalComponent;
              delete copy.__signingContext;
              return copy;
            })()
          : data;
      const lineage = approvalParams.__signingContext
        ? {
            __approvalId: approvalParams.__approvalId,
            __approvalComponent: approvalParams.__approvalComponent,
            __signingContext: approvalParams.__signingContext,
          }
        : {
            __approvalId: this.currentApproval.id,
            __approvalComponent: this.currentApproval.data.approvalComponent,
            __signingContext: approvalParams.$signingContext,
          };
      const boundData =
        cleanData && typeof cleanData === 'object'
          ? Object.assign(
              Array.isArray(cleanData) ? [...cleanData] : { ...cleanData },
              lineage
            )
          : cleanData;
      this.currentApproval?.resolve && this.currentApproval?.resolve(boundData);
    }

    const approval = this.currentApproval;

    this.clearLastRejectDapp();
    this.deleteApproval(approval);

    if (this.approvals.length > 0) {
      this.currentApproval = this.approvals[0];
    } else {
      this.currentApproval = null;
    }

    this.emit('resolve', data);
  };

  /**
   * gpt56 round-10 blocker 1: cancelling an approval must revoke everything
   * the signing operation was waiting on:
   *  - the parent-keyed AMOUNTED waiter (reject so neither the current nor a
   *    stale generation can settle after Cancel);
   *  - the deferred continuation closure (resendSign can no longer re-drive
   *    it);
   *  - the origin's authority epoch for SIGN operations, so a keyring/hardware
   *    signature already in flight fails the sink-adjacent revalidations
   *    instead of completing or broadcasting.
   * Non-signing approvals (Connect, chain prompts, Unlock) keep the existing
   * scoped-reject semantics with no epoch transition.
   */
  revokeSigningOperation = (approval: Approval | null) => {
    if (!approval) return;
    const params: any = (approval.data as any)?.params || {};
    const parentApprovalId: string | undefined =
      params.__approvalId || approval.id;
    const component = approval.data?.approvalComponent;
    const isSigningOperation =
      !!(params.$signingContext || params.__signingContext) ||
      component === 'SignTx' ||
      component === 'SignText' ||
      component === 'SignTypedData' ||
      !!params.__approvalId;
    try {
      // Lazy require: signEvent statically imports @/constant (location at
      // module scope), which must not join the notification service's
      // import graph; the registry functions themselves are context-agnostic.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signEventModule: typeof import('@/utils/signEvent') = require('@/utils/signEvent');
      if (parentApprovalId) {
        signEventModule.cancelSignComponentWait(parentApprovalId);
      }
    } catch (e) {
      // registry teardown is best-effort; epoch revocation below still fails
      // the sink adjacent asserts closed.
    }
    if (this.currentRequestDeferOwnerApprovalId === parentApprovalId) {
      this.currentRequestDeferFn = undefined;
      this.currentRequestDeferOwnerApprovalId = undefined;
    }
    const origin = approval.data?.origin;
    if (isSigningOperation && origin) {
      this.bumpOriginApprovalEpoch(origin);
    }
  };

  rejectApproval = async (
    err?: string,
    stay = false,
    isInternal = false,
    approvalId?: string,
    approvalComponent?: string
  ) => {
    // Mandatory identity: exact id + component + epoch, mirroring
    // resolveApproval (gpt56 round-10 blocker 3).
    if (
      !approvalId ||
      approvalId !== this.currentApproval?.id ||
      !approvalComponent ||
      approvalComponent !== this.currentApproval?.data?.approvalComponent ||
      (this.currentApproval as { approvedEpoch?: number })?.approvedEpoch !==
        this.approvalEpoch
    ) {
      return;
    }
    this.addLastRejectDapp();
    const approval = this.currentApproval;
    this.revokeSigningOperation(approval);
    if (this.approvals.length <= 1) {
      await this.clear(stay); // TODO: FIXME
    }

    if (isInternal) {
      approval?.reject && approval?.reject(ethErrors.rpc.internal(err));
    } else {
      approval?.reject &&
        approval?.reject(ethErrors.provider.userRejectedRequest<any>(err));
    }

    if (approval?.signingTxId) {
      transactionHistoryService.removeSigningTx(approval.signingTxId);
    }

    if (approval && this.approvals.length > 1) {
      this.deleteApproval(approval);
      this.currentApproval = this.approvals[0];
    } else {
      await this.clear(stay);
    }
    this.emit('reject', err);
  };

  requestApproval = async (
    data,
    winProps?,
    options?: { onCurrent?: () => void }
  ): Promise<any> => {
    const origin = this.getOrigin(data);
    if (origin) {
      const dapp = this.dappManager.get(origin);
      // is blocked and less 1 min
      if (
        dapp?.isBlocked &&
        Date.now() - dapp.blockedTimestamp < 60 * 1000 * 1
      ) {
        throw ethErrors.provider.userRejectedRequest(
          'User rejected the request.'
        );
      }
    }
    const currentAccount =
      data.account || preferenceService.getCurrentAccount();
    const reportExplain = (signingTxId?: string) => {
      const signingTx = signingTxId
        ? transactionHistoryService.getSigningTx(signingTxId)
        : null;
      const explain = signingTx?.explain;

      const chain = findChain({
        id: signingTx?.rawTx.chainId,
      });

      if ((explain || chain?.isTestnet) && currentAccount) {
        stats.report('preExecTransaction', {
          type: currentAccount.brandName,
          category: KEYRING_CATEGORY_MAP[currentAccount.type],
          chainId: chain?.serverId || '',
          success: explain
            ? explain.calcSuccess && explain.pre_exec.success
            : true,
          createdBy: data?.params.$ctx?.ga ? 'rabby' : 'dapp',
          source: data?.params.$ctx?.ga?.source || '',
          trigger: data?.params.$ctx?.ga?.trigger || '',
          networkType: chain?.isTestnet
            ? 'Custom Network'
            : 'Integrated Network',
        });
      }
    };
    return new Promise((resolve, reject) => {
      const uuid = uuidv4();
      let signingTxId;
      if (data.approvalComponent === 'SignTx') {
        signingTxId = transactionHistoryService.addSigningTx(
          data.params.data[0]
        );
      } else {
        signingTxId = data?.params?.signingTxId;
      }

      const approval: Approval = {
        taskId: uuid as any,
        id: uuid,
        signingTxId,
        data,
        winProps,
        approvedEpoch: this.approvalEpoch,
        resolve(data) {
          if (this.data.approvalComponent === 'SignTx') {
            reportExplain(this.signingTxId);
          }
          resolve(data);
        },
        reject(data) {
          if (this.data.approvalComponent === 'SignTx') {
            reportExplain(this.signingTxId);
          }
          reject(data);
        },
      };

      if (
        !QUEUE_APPROVAL_COMPONENTS_WHITELIST.includes(data.approvalComponent)
      ) {
        if (this.currentApproval) {
          throw ethErrors.provider.userRejectedRequest(
            'please request after current approval resolve'
          );
        }
      } else {
        if (
          this.currentApproval &&
          !QUEUE_APPROVAL_COMPONENTS_WHITELIST.includes(
            this.currentApproval.data.approvalComponent
          )
        ) {
          throw ethErrors.provider.userRejectedRequest(
            'please request after current approval resolve'
          );
        }
      }

      if (data.isUnshift) {
        this.approvals = [approval, ...this.approvals];
        this.currentApproval = approval;
      } else {
        this.approvals = [...this.approvals, approval];
        if (!this.currentApproval) {
          this.currentApproval = approval;
        }
      }

      // TODO: queued approvals currently drop onCurrent, so preparation only
      // starts for the approval that is current when requestApproval runs.
      if (this.currentApproval === approval) {
        try {
          options?.onCurrent?.();
        } catch (e) {
          Sentry.captureException(
            new Error('onCurrent failed: ' + JSON.stringify(e))
          );
        }
      }

      if (
        this.notifiWindowId !== null &&
        QUEUE_APPROVAL_COMPONENTS_WHITELIST.includes(data.approvalComponent)
      ) {
        browser.windows.update(this.notifiWindowId, {
          focused: true,
        });
      } else {
        this.openNotification(approval.winProps);
      }
    });
  };

  clear = async (stay = false) => {
    // Teardown without explicit reject (boundary clears): drop every
    // registered AMOUNTED waiter and defer so nothing can settle after the
    // queue is gone (gpt56 round-10 blocker 1). Epochs are bumped by the
    // calling boundary; this only removes in-memory continuations.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signEventModule: typeof import('@/utils/signEvent') = require('@/utils/signEvent');
      [
        ...this.approvals,
        ...(this.currentApproval ? [this.currentApproval] : []),
      ].forEach((approval: any) => {
        const params: any = approval?.data?.params || {};
        const waitId = params.__approvalId || approval?.id;
        if (waitId) {
          signEventModule.cancelSignComponentWait(waitId);
        }
      });
    } catch (e) {
      // best-effort teardown
    }
    this.currentRequestDeferFn = undefined;
    this.currentRequestDeferOwnerApprovalId = undefined;
    this.approvals = [];
    this.currentApproval = null;
    if (this.notifiWindowId !== null && !stay) {
      try {
        await winMgr.remove(this.notifiWindowId);
      } catch (e) {
        // ignore error
      }
      this.notifiWindowId = null;
    }
  };

  rejectAllApprovals = () => {
    this.addLastRejectDapp();
    this.approvals.forEach((approval) => {
      this.revokeSigningOperation(approval);
      approval.reject &&
        approval.reject(
          new EthereumProviderError(4001, 'User rejected the request.')
        );
    });
    this.approvals = [];
    this.currentApproval = null;
    this.currentRequestDeferFn = undefined;
    this.currentRequestDeferOwnerApprovalId = undefined;
    transactionHistoryService.removeAllSigningTx();
  };

  /**
   * Origin-scoped approval rejection for dapp-driven authority transitions
   * (chain switch on a supported chain, permission revocation). Only the
   * affected origin's pending approvals are rejected and removed; other
   * origins' queued approvals keep their lifecycle generation.
   */
  rejectApprovalsByOrigin = (origin: string) => {
    if (!origin) {
      return;
    }
    const victims = this.approvals.filter(
      (approval) => approval.data?.origin === origin
    );
    if (victims.length === 0) {
      return;
    }
    victims.forEach((approval) => {
      // Origin authority transitions must also tear down any signing
      // operation continuation keyed to the rejected approvals
      // (gpt56 round-10 blocker 1).
      this.revokeSigningOperation(approval);
      approval.reject &&
        approval.reject(
          new EthereumProviderError(4001, 'User rejected the request.')
        );
    });
    const remaining = this.approvals.filter(
      (approval) => !victims.includes(approval)
    );
    this.approvals = remaining;
    if (this.currentApproval && victims.includes(this.currentApproval)) {
      this.currentApproval = remaining[0] || null;
    }
  };

  unLock = () => {
    this.isLocked = false;
  };

  lock = () => {
    this.isLocked = true;
  };

  openNotification = (winProps, ignoreLock = false) => {
    // Only use ignoreLock flag when approval exist but no notification window exist
    if (!ignoreLock) {
      if (this.isLocked) return;
      this.lock();
    }
    if (this.notifiWindowId !== null) {
      winMgr.remove(this.notifiWindowId);
      this.notifiWindowId = null;
    }
    winMgr
      .openNotification(winProps)
      .then((winId) => {
        if (winId == null) {
          if (this.notifiWindowId === null) {
            this.unLock();
          }
          return;
        }
        this.notifiWindowId = winId;
      })
      .catch((e) => {
        if (this.notifiWindowId === null) {
          this.unLock();
        }
        Sentry.captureException(e, {
          tags: { function: 'openNotification' },
        });
      });
  };

  updateNotificationWinProps = (winProps: Windows.UpdateUpdateInfoType) => {
    if (this.notifiWindowId !== null) {
      browser.windows.update(this.notifiWindowId!, winProps);
    }
  };

  setCurrentRequestDeferFn = (
    fn: (retry?: boolean) => void,
    ownerApprovalId?: string
  ) => {
    this.currentRequestDeferFn = fn;
    this.currentRequestDeferOwnerApprovalId = ownerApprovalId;
  };

  callCurrentRequestDeferFn = (retry?: boolean) => {
    return this.currentRequestDeferFn?.(retry);
  };

  setStatsData = (data?: StatsData) => {
    this.statsData = data;
  };

  getStatsData = () => {
    return this.statsData;
  };

  private addLastRejectDapp() {
    // not Rabby dapp
    if (this.currentApproval?.data?.params?.$ctx) return;
    const origin = this.getOrigin();
    if (!origin) {
      return;
    }
    const dapp = this.dappManager.get(origin);
    // same origin and less 1 min
    if (dapp && Date.now() - dapp.lastRejectTimestamp < 60 * 1000) {
      dapp.lastRejectCount = dapp.lastRejectCount + 1;
      dapp.lastRejectTimestamp = Date.now();
    } else {
      this.dappManager.set(origin, {
        lastRejectTimestamp: Date.now(),
        lastRejectCount: 1,
        blockedTimestamp: 0,
        isBlocked: false,
      });
    }
  }

  private clearLastRejectDapp() {
    const origin = this.getOrigin();
    if (!origin) {
      return;
    }
    this.dappManager.delete(origin);
  }

  checkNeedDisplayBlockedRequestApproval = () => {
    const origin = this.getOrigin();
    if (!origin) {
      return false;
    }
    const dapp = this.dappManager.get(origin);
    if (!dapp) return false;
    // less 1 min and reject count more than 2 times
    if (
      Date.now() - dapp.lastRejectTimestamp < 60 * 1000 &&
      dapp.lastRejectCount >= 2
    ) {
      return true;
    }
    return false;
  };
  checkNeedDisplayCancelAllApproval = () => {
    return this.approvals.length > 1;
  };

  blockedDapp = () => {
    const origin = this.getOrigin();
    if (!origin) {
      return;
    }
    const dapp = this.dappManager.get(origin);
    if (!dapp) return;

    dapp.isBlocked = true;
    dapp.blockedTimestamp = Date.now();
  };

  private getOrigin(data = this.currentApproval?.data) {
    return data?.params?.origin || data?.origin;
  }
}

export default new NotificationService();
