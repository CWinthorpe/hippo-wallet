/**
 * @jest-environment node
 */
// Regressor for gpt56 round-8 blocker #4: the SIGN_WAITING_AMOUNTED /
// SIGN_FINISHED handshake is global and reaches every extension UI context.
// Before the fix, the events carried no approval identity, so a delayed
// hardware signature from request A could mark request B's waiting component
// as completed and B's own captured approval id would then resolve B with
// A's signature. These tests pin the binding semantics of the shared
// matcher and of the background-side waiter directly.

jest.mock('reflect-metadata', () => ({}));

const { EventEmitter } = require('events') as {
  EventEmitter: new () => any;
};

const bus = new EventEmitter();
bus.setMaxListeners(50);

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

jest.mock('@/constant', () => ({
  __esModule: true,
  EVENTS: {
    broadcastToUI: 'broadcastToUI',
    broadcastToBackground: 'broadcastToBackground',
    SIGN_FINISHED: 'SIGN_FINISHED',
    SIGN_WAITING_AMOUNTED: 'SIGN_WAITING_AMOUNTED',
  },
}));

import {
  matchesSignEvent,
  waitSignComponentAmounted,
  emitSignComponentAmounted,
} from '@/utils/signEvent';

const contextA = {
  approvalEpoch: 1,
  originEpoch: 2,
  operationId: 'op-A',
  requestDigest: '0xdaa',
  origin: 'https://a.test',
  approvalComponent: 'SignTx',
  boundAccount: { address: '0xaa', type: 'HD', brandName: 'Hippo' },
  boundChain: 'ETH',
  internalOrigin: false,
};

const bindingA = {
  approvalId: 'approval-A',
  approvalComponent: 'SignTx',
  authorityContext: contextA,
};

const contextB = { ...contextA, operationId: 'op-B', origin: 'https://b.test' };
const bindingB = {
  approvalId: 'approval-B',
  approvalComponent: 'SignTx',
  authorityContext: contextB,
};

describe('sign-event binding matcher (blocker 4)', () => {
  test('exact approval + authority binding matches', () => {
    expect(matchesSignEvent(bindingA, bindingA)).toBe(true);
  });

  test('crossed approval ids never match', () => {
    expect(
      matchesSignEvent({ ...bindingA, approvalId: 'approval-B' }, bindingA)
    ).toBe(false);
  });

  test('crossed approval components never match', () => {
    expect(
      matchesSignEvent(
        { ...bindingA, approvalComponent: 'SignTypedData' },
        bindingA
      )
    ).toBe(false);
  });

  test('operation identity changes break the match even for the same approval', () => {
    expect(
      matchesSignEvent(
        {
          ...bindingA,
          authorityContext: { ...contextA, operationId: 'op-EVIL' },
        },
        bindingA
      )
    ).toBe(false);
  });

  test('epoch drift (lock/switch between mount and completion) breaks the match', () => {
    expect(
      matchesSignEvent(
        {
          ...bindingA,
          authorityContext: { ...contextA, approvalEpoch: 99 },
        },
        bindingA
      )
    ).toBe(false);
    expect(
      matchesSignEvent(
        { ...bindingA, authorityContext: { ...contextA, originEpoch: 99 } },
        bindingA
      )
    ).toBe(false);
  });

  test('account/chain substitution breaks the match', () => {
    expect(
      matchesSignEvent(
        {
          ...bindingA,
          authorityContext: {
            ...contextA,
            boundAccount: { address: '0xevil', type: 'HD', brandName: 'Hippo' },
          },
        },
        bindingA
      )
    ).toBe(false);
    expect(
      matchesSignEvent(
        { ...bindingA, authorityContext: { ...contextA, boundChain: 'BSC' } },
        bindingA
      )
    ).toBe(false);
  });

  test('missing ids/components/contexts fail closed', () => {
    expect(matchesSignEvent(undefined, bindingA)).toBe(false);
    expect(matchesSignEvent(bindingA, undefined)).toBe(false);
    expect(matchesSignEvent({}, {})).toBe(false);
    expect(matchesSignEvent({ approvalId: 'approval-A' }, bindingA)).toBe(
      false
    );
    expect(
      matchesSignEvent({ ...bindingA, authorityContext: undefined }, bindingA)
    ).toBe(false);
  });

  test('request digest substitution breaks the match', () => {
    expect(
      matchesSignEvent(
        {
          ...bindingA,
          authorityContext: { ...contextA, requestDigest: '0xother' },
        },
        bindingA
      )
    ).toBe(false);
  });
});

describe('background-side waiter binding (blocker 4)', () => {
  test('resolves only on an exactly matching event; foreign events leave it pending', async () => {
    let settled = false;
    const waiter = waitSignComponentAmounted(bindingA).then(() => {
      settled = true;
    });

    // Foreign approval (request B) mounted and emitted its own event.
    bus.emit('SIGN_WAITING_AMOUNTED', bindingB);
    bus.emit('SIGN_WAITING_AMOUNTED', undefined);
    bus.emit('SIGN_WAITING_AMOUNTED', { approvalId: 'approval-A' });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    bus.emit('SIGN_WAITING_AMOUNTED', bindingA);
    await waiter;
    expect(settled).toBe(true);
  });

  test('late event after resolution does not re-resolve the same waiter', async () => {
    let count = 0;
    const waiter = waitSignComponentAmounted(bindingA).then(() => {
      count += 1;
    });
    bus.emit('SIGN_WAITING_AMOUNTED', bindingA);
    await waiter;
    bus.emit('SIGN_WAITING_AMOUNTED', bindingA);
    await Promise.resolve();
    expect(count).toBe(1);
  });
});

describe('UI-side emit gating (blocker 4)', () => {
  test('unscoped emits broadcast nothing; scoped emits carry the binding', () => {
    let sawBackground = false;
    let sawLocalAmounted = false;
    let backgroundPayload: any = null;
    const bgListener = (msg: any) => {
      sawBackground = true;
      backgroundPayload = msg;
    };
    const localListener = () => {
      sawLocalAmounted = true;
    };
    bus.on('broadcastToBackground', bgListener);
    bus.on('SIGN_WAITING_AMOUNTED', localListener);
    try {
      emitSignComponentAmounted();
      emitSignComponentAmounted({} as any);
      emitSignComponentAmounted({ approvalId: 'x' } as any);
      expect(sawBackground).toBe(false);
      expect(sawLocalAmounted).toBe(false);

      emitSignComponentAmounted(bindingA);
      expect(sawBackground).toBe(true);
      expect(sawLocalAmounted).toBe(true);
      expect(backgroundPayload).toEqual({
        method: 'SIGN_WAITING_AMOUNTED',
        data: bindingA,
      });
    } finally {
      bus.off('broadcastToBackground', bgListener);
      bus.off('SIGN_WAITING_AMOUNTED', localListener);
    }
  });
});
