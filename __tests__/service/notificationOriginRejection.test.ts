jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    windows: { getAll: jest.fn().mockResolvedValue([]), update: jest.fn() },
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
    openNotification: jest.fn().mockResolvedValue(1),
    remove: jest.fn(),
  },
}));

jest.mock('@/background/service/transactionHistory', () => ({
  __esModule: true,
  default: {
    addSigningTx: jest.fn(() => 'signing-tx-id'),
    getSigningTx: jest.fn(),
    removeAllSigningTx: jest.fn(),
    removeSigningTx: jest.fn(),
  },
}));

jest.mock('@/background/service/preference', () => ({
  __esModule: true,
  default: {
    getCurrentAccount: jest.fn(() => ({ address: '0xaccount' })),
  },
}));

jest.mock('@/stats', () => ({
  __esModule: true,
  default: { report: jest.fn() },
}));

jest.mock('@/utils/chain', () => ({ findChain: jest.fn() }));

jest.mock('@/utils/env', () => ({ isManifestV3: false }));

jest.mock('@sentry/browser', () => ({ captureException: jest.fn() }));

import notificationService from '@/background/service/notification';

const approvalData = (origin: string, component = 'SignTx') => ({
  approvalComponent: component as any,
  origin,
  account: { address: '0xaccount' },
  params: { data: [{}] },
});

const pendingFor = (origin: string, component?: string) => {
  let settled: 'resolved' | 'rejected' | 'pending' = 'pending';
  const promise = notificationService
    .requestApproval(approvalData(origin, component))
    .then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      }
    );
  return {
    get settled() {
      return settled;
    },
    promise,
  };
};

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

describe('notificationService origin-scoped rejection (authority transitions)', () => {
  beforeEach(() => {
    notificationService.approvals = [];
    notificationService.currentApproval = null;
    notificationService.notifiWindowId = null;
    notificationService.approvalEpoch = 0;
    notificationService.unLock();
  });

  test('rejectApprovalsByOrigin rejects only the named origin approvals', async () => {
    const victim = pendingFor('https://evil.test');
    const bystander = pendingFor('https://good.test');
    await flush();

    expect(notificationService.approvals.length).toBe(2);

    notificationService.rejectApprovalsByOrigin('https://evil.test');
    await victim.promise;
    await flush();

    expect(victim.settled).toBe('rejected');
    expect(bystander.settled).toBe('pending');
    expect(notificationService.approvals.map((a) => a.data.origin)).toEqual([
      'https://good.test',
    ]);

    notificationService.rejectAllApprovals();
    await bystander.promise;
  });

  test('currentApproval is replaced from the remaining queue, not cleared blindly', async () => {
    const first = pendingFor('https://a.test', 'SignTx');
    await flush();
    const second = pendingFor('https://b.test', 'SignTx');
    await flush();
    await notificationService.activeFirstApproval();
    expect(notificationService.currentApproval?.data.origin).toBe(
      'https://a.test'
    );

    notificationService.rejectApprovalsByOrigin('https://a.test');
    await first.promise;
    await flush();

    expect(first.settled).toBe('rejected');
    expect(notificationService.currentApproval?.data.origin).toBe(
      'https://b.test'
    );
    notificationService.rejectAllApprovals();
    await second.promise;
  });

  test('empty origin and no-match origin are inert', async () => {
    const kept = pendingFor('https://keep.test');
    await flush();

    notificationService.rejectApprovalsByOrigin('');
    notificationService.rejectApprovalsByOrigin('https://absent.test');
    await flush();

    expect(kept.settled).toBe('pending');
    expect(notificationService.approvals.length).toBe(1);
    notificationService.rejectAllApprovals();
    await kept.promise;
  });

  test('epoch bump invalidates a later exact-id resolve (session boundary fail-closed)', async () => {
    const req = pendingFor('https://epoch.test');
    await flush();
    const approval = notificationService.approvals[0];

    notificationService.bumpApprovalEpoch();
    await notificationService.resolveApproval(
      undefined,
      false,
      approval.id,
      approval.data.approvalComponent
    );
    await flush();

    // Resolve must have been a no-op: the request is still queued unpromised.
    expect(req.settled).toBe('pending');
    expect(notificationService.approvals[0].id).toBe(approval.id);

    // A resolve at the CURRENT epoch with the exact id still works.
    const matching = { ...approval } as any;
    matching.approvedEpoch = notificationService.approvalEpoch;
    notificationService.approvals = [matching];
    notificationService.currentApproval = matching;
    await notificationService.resolveApproval(
      undefined,
      false,
      approval.id,
      approval.data.approvalComponent
    );
    await req.promise;
    expect(req.settled).toBe('resolved');
  });
});
