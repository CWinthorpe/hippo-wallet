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
    // gpt56 round-12 blocker 2: settlement hooks now return booleans that
    // callers MUST consume; defaults are successful settlements (true).
    const resolveApproval = jest.fn().mockResolvedValue(true);
    const rejectApproval = jest.fn().mockResolvedValue(true);
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

  // gpt56 round-12 blocker 2: navigation away after a foreign unlock may
  // only happen when the stale approval provably went away.
  test('foreign unlock keeps the review path when the reject did not settle', async () => {
    const deps = setup(
      { id: 'unlock-request', data: { approvalComponent: 'Unlock' } },
      'unlock-request',
      false
    );
    deps.rejectApproval.mockResolvedValue(false);

    await routeNotificationAfterUnlock(deps);

    expect(deps.rejectApproval).toHaveBeenCalledTimes(1);
    // the approval is still pending (id mismatch): stay, do not claim exit
    expect(deps.replace).not.toHaveBeenCalledWith('/');
  });

  test('local gesture keeps the review path when the resolve did not settle', async () => {
    const deps = setup(
      { id: 'unlock-request', data: { approvalComponent: 'Unlock' } },
      'unlock-request',
      true
    );
    deps.resolveApproval.mockResolvedValue(false);

    await routeNotificationAfterUnlock(deps);

    expect(deps.resolveApproval).toHaveBeenCalledTimes(1);
    expect(deps.replace).not.toHaveBeenCalled();
  });

  // gpt56 round-12 blocker 4: the latch design raced a slow LOCAL attempt
  // against a FOREIGN window's global unlock. The state machine must not
  // produce settlement proof from that interleaving, ever.
  describe('window unlock attempt state machine (r12-B4)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      createWindowUnlockAttempt,
      // eslint-disable-next-line import/first
    } = require('@/ui/utils/unlockAttempt');

    test('global unlock note alone NEVER yields settlement proof', () => {
      const attempt = createWindowUnlockAttempt();
      const nonce = attempt.beginAttempt('Password');
      attempt.noteGlobalUnlock(); // foreign window unlocked while we were pending
      // local attempt later FAILS: no proof possible, ever
      expect(attempt.settleAttempt(nonce, false)).toBeNull();
      expect(attempt.consumeProof()).toBeNull();
      expect(attempt.globalUnlockSeen()).toBe(true); // display state only
    });

    test('a success for an abandoned (already-failed) nonce cannot settle', () => {
      const attempt = createWindowUnlockAttempt();
      const nonce = attempt.beginAttempt('Biometrics');
      expect(attempt.settleAttempt(nonce, false)).toBeNull();
      // late duplicate success callback for the same nonce:
      expect(attempt.settleAttempt(nonce, true)).toBeNull();
      expect(attempt.consumeProof()).toBeNull();
    });

    test('a superseded attempt cannot settle after retry replaces it', () => {
      const attempt = createWindowUnlockAttempt();
      const oldNonce = attempt.beginAttempt('Password');
      const newNonce = attempt.beginAttempt('Password');
      expect(attempt.settleAttempt(oldNonce, true)).toBeNull();
      const proof = attempt.settleAttempt(newNonce, true);
      expect(proof).toEqual({ nonce: newNonce, type: 'Password' });
    });

    test('proof is one-shot: consumed once, gone after', () => {
      const attempt = createWindowUnlockAttempt();
      const nonce = attempt.beginAttempt('Password');
      attempt.settleAttempt(nonce, true);
      expect(attempt.consumeProof()).not.toBeNull();
      expect(attempt.consumeProof()).toBeNull();
    });

    test('end-to-end race: deferred local attempt + foreign global unlock + eventual local failure settles NOTHING', async () => {
      // Drives routeNotificationAfterUnlock with the exact interleaving the
      // auditor described: window A submits (pending), window B's global
      // UNLOCK_WALLET arrives (settledLocally=false path), then A's own
      // unlock promise fails. The rendered Unlock approval must never be
      // resolved; the foreign path rejects it, and the failure produces no
      // later settlement either.
      const attempt = createWindowUnlockAttempt();
      const nonce = attempt.beginAttempt('Password');

      // foreign broadcast -> settledLocally=false: consumeProof is NOT called
      // with a real proof; route with localGesture false.
      expect(attempt.consumeProof()).toBeNull();

      const approval = {
        id: 'unlock-request',
        data: { approvalComponent: 'Unlock' },
      };
      const deps = {
        getApproval: jest.fn().mockResolvedValue(approval),
        resolveApproval: jest.fn().mockResolvedValue(true),
        rejectApproval: jest.fn().mockResolvedValue(true),
        replace: jest.fn(),
        expectedApprovalId: 'unlock-request',
        localGesture: false, // settledLocally=false path
      };
      await routeNotificationAfterUnlock(deps);
      expect(deps.resolveApproval).not.toHaveBeenCalled();
      expect(deps.rejectApproval).toHaveBeenCalledTimes(1);

      // local attempt finally fails: still no proof, no late resolution.
      expect(attempt.settleAttempt(nonce, false)).toBeNull();
      expect(attempt.consumeProof()).toBeNull();
    });
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
