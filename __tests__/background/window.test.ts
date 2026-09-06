const mockGetLastFocused = jest.fn();
const mockCreateWindow = jest.fn();
const mockUpdateWindow = jest.fn();
const mockOnMessageListener = jest.fn();
const mockOnRemovedListener = jest.fn();
const mockRemoveWindow = jest.fn();

jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    windows: {
      getLastFocused: mockGetLastFocused,
      create: mockCreateWindow,
      update: mockUpdateWindow,
      remove: mockRemoveWindow,
      onFocusChanged: { addListener: jest.fn() },
      onRemoved: { addListener: mockOnRemovedListener },
    },
    runtime: {
      id: 'test-extension-id',
      getURL: (relative: string) =>
        `chrome-extension://test-extension-id/${relative}`,
      onMessage: { addListener: mockOnMessageListener },
    },
  },
}));

jest.mock('consts', () => ({
  IS_WINDOWS: false,
}));

jest.mock('@sentry/browser', () => ({
  captureException: jest.fn(),
}));

import winMgrType from '@/background/webapi/window';

const EXT = 'chrome-extension://test-extension-id';

/**
 * Each close-authorization test gets a FRESH module instance (own nonce map,
 * own event emitter, own per-window manual-close state) so window bookkeeping
 * cannot leak between tests.
 */
const freshWindowMgr = (): {
  winMgr: typeof winMgrType;
  messageListener: (message: any, sender: any, respond?: any) => void;
  removedListener: (winId: number) => void;
} => {
  let mod: typeof winMgrType | undefined;
  jest.isolateModules(() => {
    mod = require('@/background/webapi/window').default;
  });
  if (!mod) throw new Error('window module not loaded');
  const messageListener =
    mockOnMessageListener.mock.calls[
      mockOnMessageListener.mock.calls.length - 1
    ][0];
  const removedListener =
    mockOnRemovedListener.mock.calls[
      mockOnRemovedListener.mock.calls.length - 1
    ][0];
  return { winMgr: mod, messageListener, removedListener };
};

const mockFocused = (winId: number) => {
  mockGetLastFocused
    .mockResolvedValueOnce({ top: 0, left: 0, width: 1200, height: 800 })
    .mockResolvedValueOnce({ state: 'normal' });
  mockCreateWindow.mockImplementationOnce(({ url }) =>
    Promise.resolve({ id: winId, left: 0, url })
  );
};

describe('background window manager', () => {
  beforeEach(() => {
    mockGetLastFocused.mockReset();
    mockCreateWindow.mockReset();
    mockUpdateWindow.mockReset();
  });

  it('returns undefined when the browser does not create a window', async () => {
    const { winMgr } = freshWindowMgr();
    mockGetLastFocused
      .mockResolvedValueOnce({ top: 0, left: 0, width: 1200, height: 800 })
      .mockResolvedValueOnce({ state: 'normal' });
    mockCreateWindow.mockResolvedValueOnce(null);

    await expect(winMgr.openNotification()).resolves.toBeUndefined();
    expect(mockUpdateWindow).not.toHaveBeenCalled();
  });
});

describe('notification-window close authorization (gpt56 B3)', () => {
  const NOTIFICATION_SENDER = {
    id: 'test-extension-id',
    url: `${EXT}/notification.html`,
  };

  const openWindow = async (
    winMgr: typeof winMgrType,
    winId: number
  ): Promise<string> => {
    mockFocused(winId);
    const created = await winMgr.openNotification();
    expect(created).toBe(winId);
    const url = mockCreateWindow.mock.calls[
      mockCreateWindow.mock.calls.length - 1
    ][0].url as string;
    const nonce = new URL(`https://x/${url}`).searchParams.get('closeNonce');
    expect(nonce).toBeTruthy();
    return nonce as string;
  };

  it('minting: notification creation embeds a close token in the window URL', async () => {
    const { winMgr } = freshWindowMgr();
    const nonce = await openWindow(winMgr, 4201);
    expect(nonce.length).toBeGreaterThan(10);
  });

  it('honours a closeNotification only from the notification document WITH the bound token', async () => {
    const { winMgr, messageListener, removedListener } = freshWindowMgr();
    const closeEvents: number[] = [];
    winMgr.event.on('closeNotification', (winId?: number) =>
      closeEvents.push(winId as number)
    );
    const removedEvents: Array<[number, boolean]> = [];
    winMgr.event.on('windowRemoved', (winId: number, manual: boolean) =>
      removedEvents.push([winId, manual])
    );

    const nonce = await openWindow(winMgr, 4202);
    messageListener(
      { type: 'closeNotification', closeNonce: nonce },
      NOTIFICATION_SENDER,
      jest.fn()
    );
    expect(closeEvents).toEqual([4202]);

    // The removal that follows is a programmatic (extension-initiated) close:
    // the manual-close rejection path stays suppressed for THIS window.
    removedListener(4202);
    expect(removedEvents).toEqual([[4202, false]]);
  });

  it('rejects popup, desktop, offscreen, URL-less, web-page, and content-script senders even with a valid token', async () => {
    const { winMgr, messageListener, removedListener } = freshWindowMgr();
    const closeEvents: number[] = [];
    winMgr.event.on('closeNotification', (winId?: number) =>
      closeEvents.push(winId as number)
    );

    const nonce = await openWindow(winMgr, 4203);
    for (const sender of [
      { id: 'test-extension-id', url: `${EXT}/popup.html` },
      { id: 'test-extension-id', url: `${EXT}/desktop.html` },
      { id: 'test-extension-id', url: `${EXT}/index.html` },
      { id: 'test-extension-id', url: `${EXT}/offscreen.html` },
      { id: 'test-extension-id', url: `${EXT}/sw.js` },
      { id: 'test-extension-id', url: 'https://evil.test/notification.html' },
      {
        id: 'other-extension',
        url: 'chrome-extension://other/notification.html',
      },
      { id: 'test-extension-id' }, // URL-less same-extension sender
      {
        id: 'test-extension-id',
        tab: { id: 9 },
        url: `${EXT}/notification.html`,
      },
    ]) {
      messageListener(
        { type: 'closeNotification', closeNonce: nonce },
        sender,
        jest.fn()
      );
    }
    expect(closeEvents).toEqual([]);

    // The user now closes the window: with no accepted closeNotification the
    // removal must be flagged manual so pending approvals are rejected.
    const removedEvents: Array<[number, boolean]> = [];
    winMgr.event.on('windowRemoved', (winId: number, manual: boolean) =>
      removedEvents.push([winId, manual])
    );
    removedListener(4203);
    expect(removedEvents).toEqual([[4203, true]]);
  });

  it('rejects notification-document messages without or with the wrong token', async () => {
    const { winMgr, messageListener } = freshWindowMgr();
    const closeEvents: number[] = [];
    winMgr.event.on('closeNotification', (winId?: number) =>
      closeEvents.push(winId as number)
    );

    await openWindow(winMgr, 4204);
    messageListener({ type: 'closeNotification' }, NOTIFICATION_SENDER, jest.fn());
    messageListener(
      { type: 'closeNotification', closeNonce: 'not-a-real-nonce' },
      NOTIFICATION_SENDER,
      jest.fn()
    );
    messageListener(
      { type: 'closeNotification', closeNonce: '' },
      NOTIFICATION_SENDER,
      jest.fn()
    );
    expect(closeEvents).toEqual([]);
  });

  it('close tokens are single-use', async () => {
    const { winMgr, messageListener } = freshWindowMgr();
    const closeEvents: number[] = [];
    winMgr.event.on('closeNotification', (winId?: number) =>
      closeEvents.push(winId as number)
    );

    const nonce = await openWindow(winMgr, 4205);
    messageListener(
      { type: 'closeNotification', closeNonce: nonce },
      NOTIFICATION_SENDER,
      jest.fn()
    );
    expect(closeEvents).toEqual([4205]);

    messageListener(
      { type: 'closeNotification', closeNonce: nonce },
      NOTIFICATION_SENDER,
      jest.fn()
    );
    expect(closeEvents).toEqual([4205]);
  });

  it('a token minted for one window cannot vouch for another window close', async () => {
    const { winMgr, messageListener, removedListener } = freshWindowMgr();
    const nonce = await openWindow(winMgr, 4206);
    const removedEvents: Array<[number, boolean]> = [];
    winMgr.event.on('windowRemoved', (winId: number, manual: boolean) =>
      removedEvents.push([winId, manual])
    );

    messageListener(
      { type: 'closeNotification', closeNonce: nonce },
      NOTIFICATION_SENDER,
      jest.fn()
    );
    // The token covers exactly the window it was minted for: the other
    // window's removal stays a manual close.
    removedListener(4300);
    expect(removedEvents).toEqual([[4300, true]]);
    // And the covered window resolves as programmatic.
    removedListener(4206);
    expect(removedEvents).toEqual([
      [4300, true],
      [4206, false],
    ]);
  });
});
