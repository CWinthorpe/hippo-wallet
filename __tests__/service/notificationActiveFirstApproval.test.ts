const mockGetAll = jest.fn().mockResolvedValue([]);
const mockOpenNotification = jest.fn();
const mockCaptureException = jest.fn();

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

jest.mock('consts', () => ({
  KEYRING_CATEGORY_MAP: {},
  IS_LINUX: false,
  IS_VIVALDI: false,
  IS_CHROME: false,
  KEYRING_CATEGORY: {},
  IS_WINDOWS: false,
}));

jest.mock('background/webapi', () => ({
  winMgr: {
    event: { on: jest.fn() },
    openNotification: mockOpenNotification,
    remove: jest.fn(),
  },
}));

jest.mock('@/background/service/transactionHistory', () => ({
  __esModule: true,
  default: { getSigningTx: jest.fn() },
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
jest.mock('@sentry/browser', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import notificationService from '@/background/service/notification';

describe('notificationService.activeFirstApproval', () => {
  beforeEach(() => {
    notificationService.approvals = [];
    notificationService.currentApproval = null;
    notificationService.notifiWindowId = null;
    notificationService.approvalEpoch = 0;
    mockGetAll.mockReset();
    mockOpenNotification.mockReset();
    mockCaptureException.mockReset();
  });

  test('ignores a queue cleared while checking browser windows', async () => {
    let resolveWindows!: (windows: unknown[]) => void;
    mockGetAll.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveWindows = resolve;
      })
    );
    notificationService.approvals = [
      {
        id: 'approval-id',
        approvedEpoch: 0,
        taskId: null,
        data: {
          approvalComponent: 'SignTx',
          account: {
            type: 'PrivateKey',
            address: '0xaccount',
            brandName: '私钥',
          },
        },
        winProps: {},
      },
    ];

    const activation = notificationService.activeFirstApproval();
    notificationService.approvals = [];
    resolveWindows([]);
    await activation;

    expect(mockOpenNotification).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  test('reports the original error with an approval flow tag', async () => {
    const error = new Error('windows lookup failed');
    mockGetAll.mockRejectedValueOnce(error);

    await notificationService.activeFirstApproval();

    expect(mockCaptureException).toHaveBeenCalledWith(error, {
      tags: { function: 'activeFirstApproval' },
    });
  });

  const makeApproval = (id: string, approvedEpoch = 0): any => ({
    id,
    approvedEpoch,
    taskId: null,
    data: {
      approvalComponent: 'SignTx',
      account: {
        type: 'PrivateKey',
        address: '0xaccount',
        brandName: '私钥',
      },
    },
    winProps: {},
    resolve: jest.fn(),
    reject: jest.fn(),
  });

  test('resolveApproval without a matching approval id is a no-op', async () => {
    const current = makeApproval('approval-A');
    notificationService.currentApproval = current;
    notificationService.approvals = [current];

    // Missing id must NOT resolve "whatever is current".
    await notificationService.resolveApproval({ signedTx: '0x' }, false);
    expect(current.resolve).not.toHaveBeenCalled();

    // Stale id from a rotated queue must not resolve the current approval.
    await notificationService.resolveApproval({ signedTx: '0x' }, false, 'approval-B');
    expect(current.resolve).not.toHaveBeenCalled();

    // Matching id resolves the exact approval and advances the queue. The
    // resolved payload now carries the server-side approval binding
    // (gpt56 round-8 blocker 4): the signing sink consumes
    // __approvalId/__approvalComponent/__signingContext to prove the result
    // belongs to THIS approval, so a consumer can never resolve against an
    // unrelated completion.
    await notificationService.resolveApproval({ signedTx: '0x' }, false, 'approval-A');
    expect(current.resolve).toHaveBeenCalledWith({
      signedTx: '0x',
      __approvalId: 'approval-A',
      __approvalComponent: 'SignTx',
      __signingContext: undefined,
    });
    expect(notificationService.currentApproval).toBeNull();
  });

  test('resolve binds $signingContext from the approval params when present', async () => {
    const current = makeApproval('approval-C');
    const ctx = { operationId: 'op-9', approvalEpoch: 0 };
    current.data.params = { $signingContext: ctx };
    notificationService.currentApproval = current;
    notificationService.approvals = [current];

    await notificationService.resolveApproval({ signedTx: '0x' }, false, 'approval-C');
    expect(current.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ __signingContext: ctx })
    );
  });

  test('binding attachment does not mutate the caller payload object', async () => {
    const current = makeApproval('approval-D');
    notificationService.currentApproval = current;
    notificationService.approvals = [current];
    const payload = { signedTx: '0x' };

    await notificationService.resolveApproval(payload, false, 'approval-D');
    expect(payload).toEqual({ signedTx: '0x' });
  });

  test('rejectApproval with a stale id is ignored; matching id rejects', async () => {
    const current = makeApproval('approval-A');
    notificationService.currentApproval = current;
    notificationService.approvals = [current];

    await notificationService.rejectApproval(
      'user cancelled',
      false,
      false,
      'approval-B'
    );
    expect(current.reject).not.toHaveBeenCalled();

    await notificationService.rejectApproval(
      'user cancelled',
      false,
      false,
      'approval-A'
    );
    expect(current.reject).toHaveBeenCalled();
  });

  test('a session-epoch bump invalidates in-flight resolve/reject continuations', async () => {
    const current = makeApproval('approval-A', 0);
    notificationService.currentApproval = current;
    notificationService.approvals = [current];

    // Simulate a lock: the epoch bumps and the queue is cleared.
    notificationService.bumpApprovalEpoch();
    notificationService.currentApproval = null;
    notificationService.approvals = [];

    // A pre-lock continuation that still holds the old id can no longer
    // resolve anything, because the current approval is gone.
    await notificationService.resolveApproval(
      { signedTx: '0x' },
      false,
      'approval-A'
    );
    expect(current.resolve).not.toHaveBeenCalled();
  });
});
