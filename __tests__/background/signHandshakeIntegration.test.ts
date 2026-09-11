/**
 * @jest-environment node
 */
// gpt56 round-9 blocker 1 closure: end-to-end handshake through the REAL
// NotificationService (production uuid ids) plus the REAL signEvent module.
// A dApp request creates parent approval A (component SignTx); the user's
// resolveApproval attaches operation identity; the rpcFlow child loop opens
// waiting approval B from the RESOLVED payload; the child UI derives its
// binding from B and must emit A's identity so the background waiter
// registered for A completes. Covers initial mount, retry child, foreign
// rejection, failure re-arm, and duplicate-success consumption.

import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(100);

jest.mock('@/eventBus', () => ({
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
  },
}));

jest.mock('@/constant', () => {
  const EVENTS = {
    broadcastToUI: 'broadcastToUI',
    broadcastToBackground: 'broadcastToBackground',
    SIGN_FINISHED: 'SIGN_FINISHED',
    SIGN_WAITING_AMOUNTED: 'SIGN_WAITING_AMOUNTED',
  };
  return {
    __esModule: true,
    EVENTS,
    KEYRING_CATEGORY_MAP: {},
    KEYRING_CATEGORY: {},
    IS_LINUX: false,
    IS_VIVALDI: false,
    IS_CHROME: false,
    IS_WINDOWS: false,
  };
});

const mockGetAll = jest.fn().mockResolvedValue([]);
const mockOpenNotification = jest.fn(() => Promise.resolve(99));

jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    windows: { getAll: mockGetAll, update: jest.fn() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    browserAction: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
    },
  },
}));

jest.mock('consts', () => {
  const EVENTS = {
    broadcastToUI: 'broadcastToUI',
    broadcastToBackground: 'broadcastToBackground',
    SIGN_FINISHED: 'SIGN_FINISHED',
    SIGN_WAITING_AMOUNTED: 'SIGN_WAITING_AMOUNTED',
  };
  return {
    __esModule: true,
    EVENTS,
    KEYRING_CATEGORY_MAP: {},
    IS_LINUX: false,
    IS_VIVALDI: false,
    IS_CHROME: false,
    KEYRING_CATEGORY: {},
    IS_WINDOWS: false,
  };
});

jest.mock('background/webapi', () => ({
  winMgr: {
    event: { on: jest.fn() },
    openNotification: mockOpenNotification,
    remove: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@/background/service/transactionHistory', () => ({
  __esModule: true,
  default: { getSigningTx: jest.fn(), addSigningTx: jest.fn(() => 'sigid') },
}));
jest.mock('@/background/service/preference', () => ({
  __esModule: true,
  default: { getCurrentAccount: jest.fn() },
}));
jest.mock('@/stats', () => ({
  __esModule: true,
  default: { report: jest.fn() },
}));
jest.mock('@/utils/chain', () => ({ findChain: jest.fn() }));
jest.mock('@/utils/env', () => ({ isManifestV3: false }));
jest.mock('@sentry/browser', () => ({ captureException: jest.fn() }));

import notificationService from '@/background/service/notification';
import {
  bindSignEventFromApproval,
  waitSignComponentAmounted,
  emitSignComponentAmounted,
  createSignEventConsumer,
} from '@/utils/signEvent';

const CONTEXT = {
  approvalEpoch: 0,
  originEpoch: 0,
  operationId: 'op-handshake',
  requestDigest: '0xfeed',
  origin: 'https://dapp.test',
  approvalComponent: 'SignTx',
  boundAccount: { address: '0xaa', type: 'HD', brandName: 'Hippo' },
  boundChain: 'ETH',
  internalOrigin: false,
  approvalBound: true,
};

interface ApprovalLike {
  id: string;
  data?: any;
}

/** Queue an approval through the real service; returns its promise + handle. */
const queueApproval = (approvalComponent: string, params: any) => {
  const promise = notificationService
    .requestApproval({
      approvalComponent,
      params,
      origin: CONTEXT.origin,
    })
    .catch((e) => ({ __rejected: e }));
  const approval = notificationService.currentApproval as ApprovalLike;
  if (!approval) throw new Error('approval not queued');
  // select the right one when a previous approval is still current
  const mine =
    approval.data.approvalComponent === approvalComponent &&
    approval.data.params === params
      ? approval
      : (notificationService.approvals.find(
          (a: any) =>
            a.data.approvalComponent === approvalComponent &&
            a.data.params === params
        ) as ApprovalLike);
  return { approval: mine, promise };
};

const settle = () => new Promise((r) => setImmediate(r));

describe('parent/child sign handshake integration (blocker 1)', () => {
  beforeEach(() => {
    notificationService.approvals = [];
    notificationService.currentApproval = null;
    notificationService.notifiWindowId = null;
  });

  test('child approval derives the PARENT binding and settles the background waiter', async () => {
    const parentParams = { $signingContext: CONTEXT, data: [{}] };
    const { approval: A, promise: aPromise } = queueApproval(
      'SignTx',
      parentParams
    );
    expect(A.id).toMatch(/[0-9a-f-]{36}/);

    let waiterSettled = false;
    const waiter = waitSignComponentAmounted({
      approvalId: A.id,
      approvalComponent: 'SignTx',
      authorityContext: CONTEXT,
    }).then(() => {
      waiterSettled = true;
    });

    // User approves; the resolve payload gains identity via the real path.
    await notificationService.resolveApproval(
      { tx: 'approved', uiRequestComponent: 'LedgerHardwareWaiting' },
      false,
      A.id
    );
    const resolved: any = await aPromise;
    expect(resolved.__approvalId).toBe(A.id);
    expect(resolved.__approvalComponent).toBe('SignTx');
    expect(resolved.__signingContext).toBe(CONTEXT);

    // rpcFlow child loop opens waiting approval B with the resolved payload.
    const { approval: B } = queueApproval('LedgerHardwareWaiting', resolved);

    // Child UI mount binding = the PARENT operation tuple, not B's identity.
    expect(bindSignEventFromApproval(B)).toEqual({
      approvalId: A.id,
      approvalComponent: 'SignTx',
      authorityContext: CONTEXT,
    });

    emitSignComponentAmounted(bindSignEventFromApproval(B));
    await waiter;
    expect(waiterSettled).toBe(true);
  });

  test('nested retry child keeps the parent identity; unrelated approvals cannot settle the waiter', async () => {
    const foreignParams = {
      $signingContext: { ...CONTEXT, operationId: 'op-other' },
      data: [{}],
    };
    const { approval: A } = queueApproval('SignTx', {
      $signingContext: CONTEXT,
      data: [{}],
    });
    const { approval: F } = queueApproval('SignTx', foreignParams);

    let settled = false;
    void waitSignComponentAmounted({
      approvalId: A.id,
      approvalComponent: 'SignTx',
      authorityContext: CONTEXT,
    }).then(() => {
      settled = true;
    });
    await settle();

    // unrelated operation emits with its own parent id: waiter stays pending
    emitSignComponentAmounted(bindSignEventFromApproval(F));
    await settle();
    expect(settled).toBe(false);

    // legitimate first-level child settles it
    emitSignComponentAmounted(bindSignEventFromApproval(A));
    await settle();
    expect(settled).toBe(true);
  });

  test('duplicate terminal completion consumed once; failure keeps the gate re-armed', () => {
    const binding = {
      approvalId: 'approval-A',
      approvalComponent: 'SignTx',
      authorityContext: CONTEXT,
    };
    const consumer = createSignEventConsumer(() => binding);
    expect(
      consumer.tryConsume({ ...binding, success: false, errorMsg: 't' })
    ).toBe(true);
    expect(consumer.isConsumed()).toBe(false);
    expect(
      consumer.tryConsume({ ...binding, success: true, data: '0xsig' })
    ).toBe(true);
    expect(consumer.isConsumed()).toBe(true);
    expect(
      consumer.tryConsume({ ...binding, success: true, data: '0xsig' })
    ).toBe(false);
  });

  test('resend re-registers exactly one live waiter per operation', async () => {
    const { approval: A } = queueApproval('SignTx', {
      $signingContext: CONTEXT,
      data: [{}],
    });
    let gen1 = 0;
    void waitSignComponentAmounted({
      approvalId: A.id,
      approvalComponent: 'SignTx',
      authorityContext: CONTEXT,
    }).then(() => {
      gen1 += 1;
    });
    let gen2 = 0;
    const second = waitSignComponentAmounted({
      approvalId: A.id,
      approvalComponent: 'SignTx',
      authorityContext: CONTEXT,
    }).then(() => {
      gen2 += 1;
    });
    emitSignComponentAmounted({
      approvalId: A.id,
      approvalComponent: 'SignTx',
      authorityContext: CONTEXT,
    });
    await second;
    await settle();
    expect(gen2).toBe(1);
    expect(gen1).toBe(0); // superseded generation never settles
  });
});
