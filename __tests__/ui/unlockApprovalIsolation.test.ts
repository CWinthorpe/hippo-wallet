import { routeNotificationAfterUnlock } from '@/ui/views/Unlock/approvalResolution';

describe('notification unlock approval isolation', () => {
  const setup = (
    approval?: {
      id?: string;
      data?: { approvalComponent?: unknown };
    } | null,
    expectedApprovalId?: string,
    localGesture = true
  ) => {
    const getApproval = jest.fn().mockResolvedValue(approval);
    const resolveApproval = jest.fn().mockResolvedValue(undefined);
    const rejectApproval = jest.fn().mockResolvedValue(undefined);
    const replace = jest.fn();

    return {
      getApproval,
      resolveApproval,
      rejectApproval,
      replace,
      expectedApprovalId,
      localGesture,
    };
  };

  test('does not resolve a pending signature approval after unlock', async () => {
    const deps = setup(
      {
        id: 'attacker-signature-request',
        data: { approvalComponent: 'SignTypedData' },
      },
      'attacker-signature-request'
    );

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith('/approval');
  });

  test('binds resolution to the exact Unlock approval id', async () => {
    const deps = setup(
      { id: 'unlock-request', data: { approvalComponent: 'Unlock' } },
      'unlock-request'
    );

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).toHaveBeenCalledTimes(1);
    expect(deps.resolveApproval).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      'unlock-request'
    );
    expect(deps.replace).not.toHaveBeenCalled();
  });

  test('fails closed when an Unlock approval has no id', async () => {
    const deps = setup(
      { data: { approvalComponent: 'Unlock' } },
      'some-rendered-id'
    );

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledWith('/approval');
  });

  test('returns to the wallet when no approval is pending', async () => {
    const deps = setup(null, 'stale-window-id');

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledWith('/');
  });

  test('a stale window never resolves an approval it did not render', async () => {
    // Global UNLOCK_WALLET carries no identity: window A rendered
    // 'window-a-request', but the globally current Unlock approval is now
    // 'window-b-request'. Window A must route to explicit review, never
    // resolve B's approval.
    const deps = setup(
      { id: 'window-b-request', data: { approvalComponent: 'Unlock' } },
      'window-a-request'
    );

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith('/approval');
  });

  test('missing window binding fails closed even for a matching Unlock approval', async () => {
    const deps = setup({
      id: 'unlock-request',
      data: { approvalComponent: 'Unlock' },
    });

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledWith('/approval');
  });

  test('empty-string window binding never matches', async () => {
    const deps = setup(
      { id: 'unlock-request', data: { approvalComponent: 'Unlock' } },
      ''
    );

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledWith('/approval');
  });

  // gpt56 round-10 blocker 4: a GLOBAL unlock broadcast is transport, not
  // consent. Only a local password/biometric gesture in this window may
  // resolve this window's Unlock approval.
  test('a foreign global unlock never resolves the rendered Unlock approval', async () => {
    const deps = setup(
      { id: 'unlock-request', data: { approvalComponent: 'Unlock' } },
      'unlock-request',
      false // no local gesture: the event came from another window's unlock
    );

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    // the approval is explicitly rejected so the dApp gets a definite answer
    expect(deps.rejectApproval).toHaveBeenCalledWith(
      expect.stringContaining('another window'),
      false,
      false,
      'unlock-request'
    );
    expect(deps.replace).toHaveBeenCalledWith('/');
  });

  test('local gesture resolves the exact rendered Unlock approval', async () => {
    const deps = setup(
      { id: 'unlock-request', data: { approvalComponent: 'Unlock' } },
      'unlock-request',
      true
    );

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).toHaveBeenCalledTimes(1);
    expect(deps.rejectApproval).not.toHaveBeenCalled();
  });
});
