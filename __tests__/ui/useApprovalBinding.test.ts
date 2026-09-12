import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  useApproval,
  ApprovalBinding,
  RenderedApprovalIdentityContext,
} from '@/ui/utils/hooks';

const mockWallet = {
  getApproval: jest.fn(),
  resolveApproval: jest.fn(),
  rejectApproval: jest.fn(),
  coboSafeResetCurrentAccount: jest.fn(),
};
const mockDeviceConnect = jest.fn();
const mockHistory = { replace: jest.fn(), push: jest.fn() };

jest.mock('react-router-dom', () => ({ useHistory: () => mockHistory }));
jest.mock('@/ui/utils/WalletContext', () => ({ useWallet: () => mockWallet }));
jest.mock('@/constant', () => ({ KEYRING_CLASS: {}, KEYRING_TYPE: {} }));
jest.mock('@/ui/utils/ledger', () => ({}));
jest.mock('@/ui/utils/approval-popup', () => ({
  useApprovalPopup: () => ({ showPopup: jest.fn(), enablePopup: () => false }),
}));
jest.mock('@/ui/store', () => ({}));
jest.mock('react-i18next', () => ({}));
jest.mock('@/ui/utils/useDeviceConnect', () => ({
  useDeviceConnect: () => mockDeviceConnect,
}));
jest.mock('@/ui/state/exchange', () => ({}));

describe('approval gesture binding', () => {
  let container: HTMLDivElement;
  let root: Root;
  let approvalHook: ReturnType<typeof useApproval>;
  const approval = {
    id: 'displayed-request',
    data: { approvalComponent: 'SignTx', account: { address: '0xaccount' } },
  };
  const Probe = ({ binding }: { binding?: ApprovalBinding }) => {
    approvalHook = useApproval(binding);
    return null;
  };
  const mount = (binding?: ApprovalBinding) => {
    act(() => root.render(React.createElement(Probe, { binding })));
  };
  const mountInWindow = (
    identity: { approvalId: string; approvalComponent: any } | null,
    binding?: ApprovalBinding
  ) => {
    act(() =>
      root.render(
        React.createElement(
          RenderedApprovalIdentityContext.Provider,
          { value: identity },
          React.createElement(Probe, { binding })
        )
      )
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    root = createRoot(container);
    mockWallet.getApproval.mockResolvedValue(approval);
    mockWallet.resolveApproval.mockResolvedValue(true);
    mockWallet.rejectApproval.mockResolvedValue(true);
    mockDeviceConnect.mockResolvedValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    jest.useRealTimers();
  });

  test.each([
    { approvalId: undefined, approvalComponent: 'SignTx' as const },
    { approvalId: 'old-request', approvalComponent: 'SignTx' as const },
    {
      approvalId: 'displayed-request',
      approvalComponent: 'SignTypedData' as const,
    },
  ])('refuses missing/stale/mismatched binding %j', async (binding) => {
    mount(binding);
    expect(await approvalHook[1]({})).toBe(false);
    expect(await approvalHook[2]()).toBe(false);
    jest.runAllTimers();
    expect(mockWallet.resolveApproval).not.toHaveBeenCalled();
    expect(mockWallet.rejectApproval).not.toHaveBeenCalled();
    expect(mockDeviceConnect).not.toHaveBeenCalled();
    expect(mockHistory.replace).not.toHaveBeenCalled();
    expect(mockHistory.push).not.toHaveBeenCalled();
  });

  test('rechecks the security gate after device connection waits', async () => {
    let allowed = true;
    let finishConnect!: (connected: boolean) => void;
    mockDeviceConnect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConnect = resolve;
        })
    );
    mount({
      approvalId: approval.id,
      approvalComponent: 'SignTx',
      canResolve: () => allowed,
    });
    const pending = approvalHook[1]({});
    await Promise.resolve();
    allowed = false;
    finishConnect(true);
    expect(await pending).toBe(false);
    expect(mockWallet.resolveApproval).not.toHaveBeenCalled();
  });

  test('does not resolve after its displayed request unmounts', async () => {
    let finishConnect!: (connected: boolean) => void;
    mockDeviceConnect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConnect = resolve;
        })
    );
    mount({ approvalId: approval.id, approvalComponent: 'SignTx' });
    const pending = approvalHook[1]({});
    await Promise.resolve();
    act(() => root.unmount());
    finishConnect(true);
    expect(await pending).toBe(false);
    expect(mockWallet.resolveApproval).not.toHaveBeenCalled();
  });

  test('a new valid evaluation cannot revive a submission from an obsolete evaluation', async () => {
    let version = 1;
    let finishConnect!: (connected: boolean) => void;
    mockDeviceConnect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConnect = resolve;
        })
    );
    mount({
      approvalId: approval.id,
      approvalComponent: 'SignTx',
      canResolve: () => version === 1,
    });
    const pending = approvalHook[1]({});
    await Promise.resolve();
    version = 2;
    mount({
      approvalId: approval.id,
      approvalComponent: 'SignTx',
      canResolve: () => version === 2,
    });
    finishConnect(true);
    expect(await pending).toBe(false);
    expect(mockWallet.resolveApproval).not.toHaveBeenCalled();
  });

  test('passes both captured id and component, and does not navigate when the backend refuses a stale gesture', async () => {
    mockWallet.resolveApproval.mockResolvedValue(false);
    mount({ approvalId: approval.id, approvalComponent: 'SignTx' });
    expect(await approvalHook[1]({})).toBe(false);
    expect(mockWallet.resolveApproval).toHaveBeenCalledWith(
      {},
      false,
      approval.id,
      'SignTx'
    );
    jest.runAllTimers();
    expect(mockHistory.replace).not.toHaveBeenCalled();
  });

  // gpt56 round-12 blocker 1: the approval window passes the parent-rendered
  // tuple via context; settlement must use THAT tuple even when the async
  // live-queue capture would return a different (rotated) approval.
  test('in-window settlement uses the parent-rendered identity even when the live queue already rotated', async () => {
    // The rendered approval is A; getApproval() (mount capture AND the
    // in-call live read) now returns B.
    const rotated = {
      id: 'rotated-request',
      data: {
        approvalComponent: 'SignTypedData',
        account: { address: '0xother' },
      },
    };
    mockWallet.getApproval.mockResolvedValue(rotated);
    mockWallet.resolveApproval.mockImplementation(async () => true);

    mountInWindow({
      approvalId: approval.id,
      approvalComponent: 'SignTx',
    });

    expect(await approvalHook[1]({}, false)).toBe(true);
    expect(mockWallet.resolveApproval).toHaveBeenCalledWith(
      {},
      false,
      approval.id, // the RENDERED tuple, never the rotated live id
      'SignTx'
    );
    expect(mockWallet.resolveApproval).not.toHaveBeenCalledWith(
      {},
      false,
      'rotated-request',
      expect.anything()
    );

    expect(await approvalHook[2]('user cancel', false)).toBe(true);
    expect(mockWallet.rejectApproval).toHaveBeenCalledWith(
      'user cancel',
      false,
      false,
      approval.id,
      'SignTx'
    );
  });

  test('binding identity wins over the live queue for in-window resolves', async () => {
    // SignTx-style: the component passes its binding; the queue rotated.
    const rotated = {
      id: 'rotated-request',
      data: {
        approvalComponent: 'SignTypedData',
        account: { address: '0xother' },
      },
    };
    mockWallet.getApproval.mockResolvedValue(rotated);
    mockWallet.resolveApproval.mockImplementation(async () => true);

    mountInWindow(
      { approvalId: approval.id, approvalComponent: 'SignTx' },
      { approvalId: approval.id, approvalComponent: 'SignTx' as any }
    );

    // matchesBinding checks the LIVE approval against the binding; the live
    // queue is B while the binding is A, so settlement fails closed.
    expect(await approvalHook[1]({}, false)).toBe(false);
    expect(mockWallet.resolveApproval).not.toHaveBeenCalled();
  });

  test('legacy callers also bind their captured request when resolving or rejecting', async () => {
    mount();
    expect(await approvalHook[1]({}, true)).toBe(true);
    expect(mockWallet.resolveApproval).toHaveBeenCalledWith(
      {},
      false,
      approval.id,
      'SignTx'
    );
    expect(await approvalHook[2](undefined, true)).toBe(true);
    expect(mockWallet.rejectApproval).toHaveBeenCalledWith(
      undefined,
      true,
      false,
      approval.id,
      'SignTx'
    );
  });
});
