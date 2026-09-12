import type { Approval } from '@/background/service/notification';
import {
  assertApprovalSigningBinding,
  waitForApprovalSigning,
} from '@/background/controller/walletUtils/approvalSigning';
import { waitSignComponentAmounted } from '@/utils/signEvent';
import type { SignEventBinding } from '@/utils/signEvent';
import type { AuthorityContext } from '@/background/service/sessionBoundary';
import eventBus from '@/eventBus';

jest.mock('@/constant', () => ({
  EVENTS: { SIGN_WAITING_AMOUNTED: 'SIGN_WAITING_AMOUNTED' },
}));

const address = '0x123';
const typedData = { domain: { chainId: 1 }, message: { amount: '100' } };
const request = {
  type: 'HD Key Tree',
  from: address,
  data: typedData,
  options: {
    sourceApprovalId: 'reviewed-request',
    approvalComponent: 'PrivatekeyWaiting' as const,
  },
};
const makeApproval = (): Approval => ({
  id: 'waiting-request',
  // Hippo extends Approval with a mandatory lifecycle epoch (gpt56 round-10
  // contract); mock fixtures must carry it exactly like requestApproval does.
  approvedEpoch: 0,
  taskId: null,
  winProps: {},
  data: {
    account: { address, type: request.type, brandName: 'Seed phrase' },
    approvalComponent: 'PrivatekeyWaiting',
    params: {
      sourceApprovalId: request.options.sourceApprovalId,
      isGnosis: true,
      type: request.type,
      address,
      data: [address, JSON.stringify(typedData)],
    },
  },
});

// Hippo's AMOUNTED waiter is identity-bound: the waiter is registered under
// an exact (approvalId, approvalComponent, authorityContext) operation
// binding and a global mount event resolves it only when it carries that
// same binding (stricter than upstream's data-less handshake event).
const authorityContext: AuthorityContext = {
  approvalEpoch: 0,
  originEpoch: 0,
  operationId: 'op-1',
  requestDigest: 'digest-1',
  origin: 'https://dapp.test',
  approvalComponent: 'PrivatekeyWaiting',
  boundAccount: { address, type: request.type, brandName: 'Seed phrase' },
  internalOrigin: false,
  approvalBound: true,
};
const binding: SignEventBinding = {
  approvalId: 'waiting-request',
  approvalComponent: 'PrivatekeyWaiting',
  authorityContext,
};

describe('bound deferred Safe signing', () => {
  let currentApproval: Approval | null;

  beforeEach(() => {
    currentApproval = makeApproval();
    eventBus.removeAllEventListeners('SIGN_WAITING_AMOUNTED');
  });

  const mountEvent = () =>
    eventBus.emit('SIGN_WAITING_AMOUNTED', {
      approvalId: binding.approvalId,
      approvalComponent: binding.approvalComponent,
      authorityContext: binding.authorityContext,
    });

  const waitForApproval = (sign: () => void) =>
    waitForApprovalSigning({
      ...request,
      getApproval: () => currentApproval,
      waitForUI: () => waitSignComponentAmounted(binding),
    }).then(sign);

  test('signs only after the matching waiting approval mounts', async () => {
    const sign = jest.fn();
    const pending = waitForApproval(sign);
    expect(sign).not.toHaveBeenCalled();
    mountEvent();
    await pending;
    expect(sign).toHaveBeenCalledTimes(1);
  });

  test('an unmatching global mount event cannot settle the waiter', async () => {
    const sign = jest.fn();
    const pending = waitForApproval(sign);
    eventBus.emit('SIGN_WAITING_AMOUNTED', {
      approvalId: 'other-operation',
      approvalComponent: binding.approvalComponent,
      authorityContext: binding.authorityContext,
    });
    // A foreign-generation event is IGNORED by the identity-bound waiter:
    // nothing settles, and a later exact-matching event completes normally.
    expect(sign).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(sign).not.toHaveBeenCalled();
    mountEvent();
    await pending;
    expect(sign).toHaveBeenCalledTimes(1);
  });


  test.each([
    [
      'source id',
      (approval: Approval) => {
        approval.data.params.sourceApprovalId = 'other-source';
      },
    ],
    [
      'component',
      (approval: Approval) => {
        approval.data.approvalComponent = 'LedgerHardwareWaiting';
      },
    ],
    [
      'Safe marker',
      (approval: Approval) => {
        approval.data.params.isGnosis = false;
      },
    ],
    [
      'signer address',
      (approval: Approval) => {
        approval.data.params.address = '0x456';
      },
    ],
    [
      'payload signer',
      (approval: Approval) => {
        approval.data.params.data[0] = '0x456';
      },
    ],
    [
      'account',
      (approval: Approval) => {
        approval.data.account.address = '0x456';
      },
    ],
    [
      'account type',
      (approval: Approval) => {
        approval.data.account.type = 'Other type';
      },
    ],
    [
      'typed payload',
      (approval: Approval) => {
        approval.data.params.data[1] = JSON.stringify({
          ...typedData,
          message: { amount: '999' },
        });
      },
    ],
  ] as const)(
    'rejects mismatched %s after a global mount event',
    async (_name, change) => {
      const sign = jest.fn();
      const pending = waitForApproval(sign);
      change(currentApproval!);
      mountEvent();
      await expect(pending).rejects.toMatchObject({ code: 4001 });
      expect(sign).not.toHaveBeenCalled();
    }
  );

  test('an old listener cannot sign after the pending approval is cleared', async () => {
    const sign = jest.fn();
    const pending = waitForApproval(sign);
    currentApproval = null;
    mountEvent();
    await expect(pending).rejects.toMatchObject({ code: 4001 });
    expect(sign).not.toHaveBeenCalled();
  });

  test('failed source consent cannot be supplied by a later unrelated waiting approval', async () => {
    const sign = jest.fn();
    const pending = waitForApproval(sign);
    currentApproval = makeApproval();
    currentApproval.data.params.sourceApprovalId = 'next-request';
    mountEvent();
    await expect(pending).rejects.toMatchObject({ code: 4001 });
    expect(sign).not.toHaveBeenCalled();
  });

  test('rechecking after an awaited keyring lookup rejects a session change', async () => {
    let finishKeyringLookup!: () => void;
    const sign = jest.fn();
    const keyringLookup = new Promise<void>((resolve) => {
      finishKeyringLookup = resolve;
    });
    const pending = waitForApprovalSigning({
      ...request,
      getApproval: () => currentApproval,
      waitForUI: () => waitSignComponentAmounted(binding),
    }).then(async () => {
      await keyringLookup;
      assertApprovalSigningBinding(currentApproval, request);
      sign();
    });
    mountEvent();
    await Promise.resolve();
    await Promise.resolve();
    currentApproval = null;
    finishKeyringLookup();
    await expect(pending).rejects.toMatchObject({ code: 4001 });
    expect(sign).not.toHaveBeenCalled();
  });

  test('fails closed for incomplete binding, while preserving legacy callers', () => {
    expect(() =>
      assertApprovalSigningBinding(currentApproval, {
        ...request,
        options: { sourceApprovalId: request.options.sourceApprovalId },
      })
    ).toThrow();
    expect(() =>
      assertApprovalSigningBinding(null, { ...request, options: undefined })
    ).not.toThrow();
  });
});
