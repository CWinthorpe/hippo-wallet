/**
 * @jest-environment node
 */
// Regressor for gpt56 round-3 blocker B1: transitions that fire AFTER an
// approval resolved, or DURING the signing-component wait, must fail the
// sign/broadcast sink closed with a user-rejected error and zero handler
// execution. Every scenario below interleaves a trust-boundary mutation
// (lock, account switch, site-account reassignment, chain switch, permission
// revocation) between approval resolution and the privileged handler, and
// asserts the handler never ran.

import 'reflect-metadata';
import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

jest.mock('@/eventBus', () => {
  const { EventEmitter: BusEmitter } = jest.requireActual('events');
  const bus = new BusEmitter();
  return {
    __esModule: true,
    default: {
      emit: (method: string, params?: unknown) => bus.emit(method, params),
      once: (method: string, cb: () => void) => bus.once(method, cb),
      off: (method: string, cb: (...args: unknown[]) => void) =>
        bus.off(method, cb),
      addEventListener: (method: string, cb: (...args: unknown[]) => void) =>
        bus.on(method, cb),
      removeEventListener: (method: string, cb: (...args: unknown[]) => void) =>
        bus.off(method, cb),
      __bus: bus,
    },
  };
});

jest.mock('@/background/service/notification', () => ({
  __esModule: true,
  default: {
    rejectAllApprovals: jest.fn(),
    clear: jest.fn(),
    bumpApprovalEpoch: jest.fn(),
  },
}));

jest.mock('@/background/service/permission', () => ({
  __esModule: true,
  default: {
    getSites: jest.fn(() => []),
  },
}));

jest.mock('@/background/service/preference', () => ({
  __esModule: true,
  default: {
    getCurrentAccount: jest.fn(() => null),
    setCurrentAccount: jest.fn(),
  },
}));

jest.mock('@/background/service/remoteDataPolicy', () => ({
  __esModule: true,
  default: {
    lock: jest.fn(() => Promise.resolve()),
  },
}));

const state = {
  unlocked: true,
  approvalEpoch: 0,
  originEpochs: new Map<string, number>(),
  hasPermission: true,
  siteChain: 'ETH',
  siteAccount: null as null | {
    address: string;
    type: string;
    brandName: string;
  },
  currentAccount: { address: '0xcurrent', type: 'HD', brandName: 'Hippo' },
  isEnabledDappAccount: false,
  internalOrigin: false,
};

const rejectedApprovals: string[] = [];

jest.mock('background/service', () => ({
  keyringService: {
    memStore: {
      getState: () => ({ isUnlocked: state.unlocked }),
    },
  },
  notificationService: {
    approvalEpoch: 0,
    getOriginApprovalEpoch: (origin: string) =>
      state.originEpochs.get(origin) ?? 0,
    bumpOriginApprovalEpoch: (origin: string) => {
      state.originEpochs.set(origin, (state.originEpochs.get(origin) ?? 0) + 1);
    },
    rejectApprovalsByOrigin: jest.fn((origin: string) => {
      rejectedApprovals.push(origin);
    }),
    requestApproval: jest.fn(),
    setCurrentRequestDeferFn: jest.fn(),
    unLock: jest.fn(),
    setStatsData: jest.fn(),
    getStatsData: jest.fn(),
  },
  permissionService: {
    hasPermission: jest.fn(() => state.hasPermission),
    getConnectedSite: jest.fn(() => ({
      origin: 'https://dapp.test',
      chain: state.siteChain,
      account: state.siteAccount,
      isConnected: true,
    })),
    updateConnectSite: jest.fn(),
    touchConnectedSite: jest.fn(),
    isInternalOrigin: jest.fn(() => state.internalOrigin),
    addConnectedSiteV2: jest.fn(),
  },
  preferenceService: {
    getPreference: jest.fn((key?: string) =>
      key === 'isEnabledDappAccount' ? state.isEnabledDappAccount : undefined
    ),
    getCurrentAccount: jest.fn(() => state.currentAccount),
    setCurrentAccount: jest.fn(),
  },
}));

jest.mock('background/utils', () => {
  const PromiseFlow = jest.requireActual('@/background/utils/promiseFlow')
    .default;
  return {
    PromiseFlow,
    underline2Camelcase: (str: string) =>
      str.replace(/_(.)/g, (_m, p1: string) => p1.toUpperCase()),
  };
});

const handlerCalls: unknown[][] = [];

const mockController: Record<string, any> = {
  ethRpc: jest.fn(),
};
mockController.ethSendTransaction = (...args: unknown[]) => {
  handlerCalls.push(args);
  return Promise.resolve('0xhandled');
};

jest.mock('@/background/controller/provider/controller', () => ({
  __esModule: true,
  default: mockController,
}));

// The APPROVAL metadata is registered AFTER the mock factory runs, at module
// scope below, against the exported mock controller object.
jest.mock('@/constant', () => {
  const EVENTS = {
    broadcastToUI: 'broadcastToUI',
    SIGN_FINISHED: 'SIGN_FINISHED',
    SIGN_WAITING_AMOUNTED: 'SIGN_WAITING_AMOUNTED',
  };
  return {
    __esModule: true,
    EVENTS,
    INTERNAL_REQUEST_ORIGIN: 'self://hippo.origin',
    KEYRING_CLASS: { MULTI_ADDRESS: 'MultiAddress' },
    KEYRING_TYPE: {
      SimpleKeyring: 'SimpleKeyring',
      HdKeyring: 'HD Key Tree',
      GnosisKeyring: 'Gnosis Keyring',
      CoboArgusKeyring: 'CoboArgus Keyring',
      WatchKeyring: 'Watch Address',
    },
    SUPPORT_1559_KEYRING_TYPE: ['HD Key Tree'],
  };
});

jest.mock('consts', () => {
  const EVENTS = {
    broadcastToUI: 'broadcastToUI',
    SIGN_FINISHED: 'SIGN_FINISHED',
    SIGN_WAITING_AMOUNTED: 'SIGN_WAITING_AMOUNTED',
  };
  return {
    __esModule: true,
    EVENTS,
    INTERNAL_REQUEST_ORIGIN: 'self://hippo.origin',
    KEYRING_CLASS: { MULTI_ADDRESS: 'MultiAddress' },
    KEYRING_TYPE: {
      SimpleKeyring: 'SimpleKeyring',
      HdKeyring: 'HD Key Tree',
      GnosisKeyring: 'Gnosis Keyring',
      CoboArgusKeyring: 'CoboArgus Keyring',
      WatchKeyring: 'Watch Address',
    },
    SUPPORT_1559_KEYRING_TYPE: ['HD Key Tree'],
  };
});

jest.mock('@/utils', () => ({
  resemblesETHAddress: (value: unknown) =>
    typeof value === 'string' && value.startsWith('0x'),
}));

jest.mock('@sentry/browser', () => ({ captureException: jest.fn() }));
jest.mock('@/stats', () => ({
  __esModule: true,
  default: { report: jest.fn() },
}));
jest.mock('@/utils/chain', () => ({
  findChain: jest.fn(() => undefined),
  findChainByEnum: jest.fn(() => undefined),
}));
jest.mock('@/background/controller/provider/gnosisController', () => ({
  gnosisController: { watchMessage: jest.fn() },
}));
jest.mock('@/background/utils/errorTxRetry', () => ({
  bgRetryTxMethods: {
    getRetryTxType: jest.fn(() => null),
    getRetryTxRecommendNonce: jest.fn(() => '0x1'),
  },
}));
jest.mock('@/utils/ga4', () => ({ ga4: { fireEvent: jest.fn() } }));
jest.mock('@/utils/transaction', () => ({
  buildSignTx: jest.fn((x: unknown) => x),
  normalizeTxParams: jest.fn((x: unknown) => x),
  shouldUpdateNonce: jest.fn(() => false),
}));
jest.mock('@/background/service/signTxPreparation', () => ({
  startSignTxPreparation: jest.fn(),
  cancelSignTxPreparation: jest.fn(),
}));

// Controllable signing-component wait: tests resolve it on demand so they can
// interleave transitions DURING the wait.
let resolveSignComponentWait: () => void = () => {};
let signComponentWaitPromise: Promise<void> = Promise.resolve();
let signComponentWaitStarted: (() => void) | undefined;
const armSignComponentWait = () => {
  signComponentWaitPromise = new Promise<void>((resolve) => {
    resolveSignComponentWait = () => resolve();
  });
};
armSignComponentWait();
jest.mock('@/utils/signEvent', () => ({
  waitSignComponentAmounted: jest.fn(() => {
    signComponentWaitStarted?.();
    return signComponentWaitPromise;
  }),
  emitSignComponentAmounted: jest.fn(),
}));

import {
  keyringService,
  notificationService,
  permissionService,
  preferenceService,
} from 'background/service';
import rpcFlow from '@/background/controller/provider/rpcFlow';

// Register the APPROVAL metadata for the mocked handler exactly the way
// controller.ts does via decorators.
Reflect.defineMetadata(
  'APPROVAL',
  ['SignTx', undefined, {}],
  mockController,
  'ethSendTransaction'
);

// The notificationService/permissionService/preferenceService imported above
// are the SAME mock objects rpcFlow sees (same module factory), but rpcFlow
// imported them via 'background/service' — jest reuses the mock module, so
// these aliases are the live objects. The epoch fields on rpcFlow's copy are
// read dynamically through getters below.

const DAPP_ORIGIN = 'https://dapp.test';
const APPROVED_ACCOUNT = {
  address: '0xCurrent',
  type: 'HD Key Tree',
  brandName: 'Hippo',
};

const flush = async () => {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
};

const makeRequest = () => ({
  data: {
    method: 'eth_sendTransaction',
    params: [
      {
        from: APPROVED_ACCOUNT.address,
        to: '0xcontract',
        value: '0x1',
        chainId: 1,
      },
    ],
  },
  session: { origin: DAPP_ORIGIN, name: 'Dapp', icon: '' },
  account: { ...APPROVED_ACCOUNT },
});

let pendingApprovalResolve:
  | ((value: Record<string, unknown>) => void)
  | null = null;

const queueApproval = (approvalResult: Record<string, unknown>) => {
  ((notificationService as unknown) as {
    requestApproval: jest.Mock;
  }).requestApproval.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        pendingApprovalResolve = () => resolve(approvalResult);
      })
  );
};

describe('rpcFlow post-approval / sign-wait trust boundaries (B1)', () => {
  beforeEach(() => {
    handlerCalls.length = 0;
    rejectedApprovals.length = 0;
    state.unlocked = true;
    state.approvalEpoch = 0;
    state.originEpochs = new Map();
    state.hasPermission = true;
    state.siteChain = 'ETH';
    state.siteAccount = null;
    state.currentAccount = { ...APPROVED_ACCOUNT };
    state.isEnabledDappAccount = false;
    state.internalOrigin = false;
    pendingApprovalResolve = null;
    signComponentWaitStarted = undefined;
    armSignComponentWait();
    const requestApprovalMock = ((notificationService as unknown) as {
      requestApproval: jest.Mock;
    }).requestApproval;
    requestApprovalMock.mockReset();
    requestApprovalMock.mockImplementation(() => Promise.resolve({}));
    ((notificationService as unknown) as {
      approvalEpoch: number;
    }).approvalEpoch = state.approvalEpoch;
  });

  // Returns a wrapper object so the caller's `await` cannot unwrap (and thus
  // deadlock on) the still-pending flow promise itself.
  const startRequest = async () => {
    queueApproval({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    const promise = (rpcFlow(
      makeRequest() as never
    ) as unknown) as Promise<unknown>;
    await flush();
    // The request is now parked awaiting the approval.
    expect(pendingApprovalResolve).not.toBeNull();
    return { promise };
  };

  const settle = <T>(promise: Promise<T>) =>
    promise.then(
      (value) => ({ status: 'resolved' as const, value }),
      (error) => ({ status: 'rejected' as const, error })
    );

  test('baseline: approval resolves with no transition and the handler runs', async () => {
    const { promise } = await startRequest();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    await expect(promise).resolves.toBe('0xhandled');
    expect(handlerCalls.length).toBe(1);
  });

  test('global epoch bump (lock/account switch) AFTER approval resolves rejects fail-closed', async () => {
    const { promise } = await startRequest();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    // Boundary fires after approval resolution, before the continuation runs.
    ((notificationService as unknown) as {
      approvalEpoch: number;
    }).approvalEpoch += 1;
    const outcome = await settle(promise);
    expect(outcome.status).toBe('rejected');
    expect((outcome as { error: { code?: number } }).error.code).toBe(4001);
    expect(handlerCalls.length).toBe(0);
  });

  test('wallet lock AFTER approval resolves rejects fail-closed', async () => {
    const { promise } = await startRequest();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    state.unlocked = false;
    const outcome = await settle(promise);
    expect(outcome.status).toBe('rejected');
    expect((outcome as { error: { code?: number } }).error.code).toBe(4001);
    expect(handlerCalls.length).toBe(0);
  });

  test('site-account reassignment (origin epoch bump) AFTER approval resolves rejects fail-closed', async () => {
    const { promise } = await startRequest();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    // setSiteAccount-equivalent: the site's account and per-origin epoch move.
    state.siteAccount = {
      address: '0xother',
      type: 'HD Key Tree',
      brandName: 'Hippo',
    };
    state.originEpochs.set(DAPP_ORIGIN, 1);
    const outcome = await settle(promise);
    expect(outcome.status).toBe('rejected');
    expect((outcome as { error: { code?: number } }).error.code).toBe(4001);
    expect(handlerCalls.length).toBe(0);
  });

  test('site-account reassignment to a DIFFERENT address is rejected even via live account drift alone', async () => {
    // dapp-account mode: the effective account for the origin drifts without
    // any epoch bump (defense-in-depth: identity check is independent).
    state.isEnabledDappAccount = true;
    state.siteAccount = { ...APPROVED_ACCOUNT };
    const { promise } = await startRequest();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    state.siteAccount = {
      address: '0xattacker',
      type: 'HD Key Tree',
      brandName: 'Hippo',
    };
    const outcome = await settle(promise);
    expect(outcome.status).toBe('rejected');
    expect(handlerCalls.length).toBe(0);
  });

  test('chain switch AFTER approval resolves rejects fail-closed', async () => {
    const { promise } = await startRequest();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    state.siteChain = 'BSC';
    const outcome = await settle(promise);
    expect(outcome.status).toBe('rejected');
    expect(handlerCalls.length).toBe(0);
  });

  test('permission revocation AFTER approval resolves rejects fail-closed', async () => {
    const { promise } = await startRequest();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    state.hasPermission = false;
    const outcome = await settle(promise);
    expect(outcome.status).toBe('rejected');
    expect(handlerCalls.length).toBe(0);
  });

  test('transition DURING the signing-component wait rejects with zero handler execution', async () => {
    // The approval resolves with a uiRequestComponent so the deferred
    // handler path runs waitSignComponentAmounted() before the sink.
    let waitStarted = false;
    signComponentWaitStarted = () => {
      waitStarted = true;
    };
    (permissionService.hasPermission as jest.Mock).mockImplementation(
      () => state.hasPermission
    );

    ((notificationService as unknown) as {
      requestApproval: jest.Mock;
    }).requestApproval.mockImplementationOnce(() =>
      Promise.resolve({
        nonce: '0x1',
        gas: '0x5208',
        gasPrice: '0x1',
        uiRequestComponent: 'LedgerHardwareWaiting',
        $account: APPROVED_ACCOUNT,
      })
    );
    ((notificationService as unknown) as {
      requestApproval: jest.Mock;
    }).requestApproval.mockImplementationOnce(() =>
      Promise.resolve('0xuicompsign')
    );

    const promise = (rpcFlow(
      makeRequest() as never
    ) as unknown) as Promise<unknown>;
    // The UI-component approval loop resolves; the deferred path is parked in
    // the signing-component wait.
    const flowResult = await promise;
    expect(flowResult).toBe('0xuicompsign');
    await flush();
    expect(waitStarted).toBe(true);
    expect(handlerCalls.length).toBe(0);

    // A boundary fires WHILE the hardware component is mounting.
    state.originEpochs.set(DAPP_ORIGIN, 1);
    resolveSignComponentWait();
    await flush();
    await flush();
    // The sink must not execute after the wait resolves past a boundary.
    expect(handlerCalls.length).toBe(0);
  });

  test('no transition: signing-component wait completion still reaches the handler', async () => {
    let waitStarted = false;
    signComponentWaitStarted = () => {
      waitStarted = true;
    };
    ((notificationService as unknown) as {
      requestApproval: jest.Mock;
    }).requestApproval.mockImplementationOnce(() =>
      Promise.resolve({
        nonce: '0x1',
        gas: '0x5208',
        gasPrice: '0x1',
        uiRequestComponent: 'LedgerHardwareWaiting',
        $account: APPROVED_ACCOUNT,
      })
    );
    ((notificationService as unknown) as {
      requestApproval: jest.Mock;
    }).requestApproval.mockImplementationOnce(() =>
      Promise.resolve('0xuicompsign')
    );

    const promise = (rpcFlow(
      makeRequest() as never
    ) as unknown) as Promise<unknown>;
    await promise;
    await flush();
    expect(waitStarted).toBe(true);
    resolveSignComponentWait();
    await flush();
    await flush();
    expect(handlerCalls.length).toBe(1);
  });

  test('transition DURING the UI-component approval loop rejects the request', async () => {
    // Gap between post-approval revalidation (middleware 4) and deferred
    // handler creation: the UI-component approval round trip. A boundary
    // there must reject the flow, not hand the dApp a false success.
    let releaseLoop: ((value: unknown) => void) | null = null;
    ((notificationService as unknown) as {
      requestApproval: jest.Mock;
    }).requestApproval.mockImplementationOnce(() =>
      Promise.resolve({
        nonce: '0x1',
        gas: '0x5208',
        gasPrice: '0x1',
        uiRequestComponent: 'LedgerHardwareWaiting',
        $account: APPROVED_ACCOUNT,
      })
    );
    ((notificationService as unknown) as {
      requestApproval: jest.Mock;
    }).requestApproval.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseLoop = () => resolve('0xuicompsign');
        })
    );

    const promise = (rpcFlow(
      makeRequest() as never
    ) as unknown) as Promise<unknown>;
    await flush();
    expect(releaseLoop).not.toBeNull();

    // Boundary fires while the UI-component approval is still pending.
    state.hasPermission = false;
    releaseLoop!('0xuicompsign');

    const outcome = await settle(promise);
    expect(outcome.status).toBe('rejected');
    expect(handlerCalls.length).toBe(0);
  });

  test('internal-origin requests are not identity-checked but still respect global epochs', async () => {
    state.internalOrigin = true;
    const internalRequest = makeRequest();
    (internalRequest as any).session = {
      origin: 'self://hippo.origin',
      name: 'Hippo',
      icon: '',
    };
    queueApproval({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    const promise = (rpcFlow(
      internalRequest as never
    ) as unknown) as Promise<unknown>;
    await flush();
    pendingApprovalResolve!({ nonce: '0x1', gas: '0x5208', gasPrice: '0x1' });
    // Identity drift must not affect an internal request...
    state.currentAccount = {
      address: '0xelsewhere',
      type: 'HD Key Tree',
      brandName: 'Hippo',
    };
    await expect(promise).resolves.toBe('0xhandled');
    expect(handlerCalls.length).toBe(1);

    // ...but a global session boundary still kills it.
    handlerCalls.length = 0;
    queueApproval({ nonce: '0x2', gas: '0x5208', gasPrice: '0x1' });
    const promise2 = (rpcFlow(
      internalRequest as never
    ) as unknown) as Promise<unknown>;
    await flush();
    pendingApprovalResolve!({ nonce: '0x2', gas: '0x5208', gasPrice: '0x1' });
    ((notificationService as unknown) as {
      approvalEpoch: number;
    }).approvalEpoch += 1;
    const outcome = await settle(promise2);
    expect(outcome.status).toBe('rejected');
    expect(handlerCalls.length).toBe(0);
  });
});
