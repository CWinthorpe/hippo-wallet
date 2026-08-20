import { routeNotificationAfterUnlock } from '@/ui/views/Unlock/approvalResolution';

describe('notification unlock approval isolation', () => {
  const setup = (approval?: {
    id?: string;
    data?: { approvalComponent?: unknown };
  } | null) => {
    const getApproval = jest.fn().mockResolvedValue(approval);
    const resolveApproval = jest.fn().mockResolvedValue(undefined);
    const replace = jest.fn();

    return { getApproval, resolveApproval, replace };
  };

  test('does not resolve a pending signature approval after unlock', async () => {
    const deps = setup({
      id: 'attacker-signature-request',
      data: { approvalComponent: 'SignTypedData' },
    });

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith('/approval');
  });

  test('binds resolution to the exact Unlock approval id', async () => {
    const deps = setup({
      id: 'unlock-request',
      data: { approvalComponent: 'Unlock' },
    });

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
    const deps = setup({ data: { approvalComponent: 'Unlock' } });

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledWith('/approval');
  });

  test('returns to the wallet when no approval is pending', async () => {
    const deps = setup(null);

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledWith('/');
  });
});
