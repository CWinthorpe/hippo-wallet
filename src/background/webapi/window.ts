import * as Sentry from '@sentry/browser';
import browser, { Windows } from 'webextension-polyfill';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { IS_WINDOWS } from 'consts';
import { isNotificationDocumentSender } from '@/offscreen/scripts/senderAuth';

const event = new EventEmitter();

// if focus other windows, then reject the approval
browser.windows.onFocusChanged.addListener((winId) => {
  event.emit('windowFocusChange', winId);
});

/**
 * Per-window close tokens (gpt56 round-3 blocker B3). `closeNotification`
 * decides whether the next removal of a specific notification window counts
 * as a programmatic (extension-initiated) close or a manual (user) close —
 * and a manual close is what rejects the captured approvals. Previously ANY
 * same-extension page could send it and globally disarm the rejection path.
 * Now the message must (a) come from the notification document path itself,
 * and (b) carry the nonce that was minted for one specific notification
 * window and delivered ONLY into that window's URL. Manual-close state is
 * tracked per window id, so a token can never vouch for another window.
 */
const closeNotificationNonces = new Map<string, number>();
const programmaticCloses = new Set<number>();

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'closeNotification') return;
  // Only the notification document itself may declare its own window closed
  // by the extension; content scripts, web pages, and every other extension
  // trust zone are rejected (exact-document predicate, not same-extension).
  if (!isNotificationDocumentSender(sender)) return;
  const nonce =
    typeof message.closeNonce === 'string' ? message.closeNonce : '';
  const winId = nonce ? closeNotificationNonces.get(nonce) : undefined;
  if (winId === undefined) return;
  // Single-use: a replayed message cannot re-arm the manual-close state.
  closeNotificationNonces.delete(nonce);
  programmaticCloses.add(winId);
  event.emit('closeNotification', winId);
});
browser.windows.onRemoved.addListener((winId) => {
  for (const [nonce, mappedWinId] of closeNotificationNonces) {
    if (mappedWinId === winId) closeNotificationNonces.delete(nonce);
  }
  const isManualClose = !programmaticCloses.delete(winId);
  event.emit('windowRemoved', winId, isManualClose);
});

const BROWSER_HEADER = 80;
const WINDOW_SIZE = {
  width: 400 + (IS_WINDOWS ? 14 : 0), // idk why windows cut the width.
  height: 600,
};

const createFullScreenWindow = ({ url, ...rest }) => {
  return browser.windows.create({
    focused: true,
    url,
    type: 'popup',
    ...rest,
    width: undefined,
    height: undefined,
    left: undefined,
    top: undefined,
    state: 'fullscreen',
  });
};

const create = async ({ url, ...rest }): Promise<number | undefined> => {
  const [normalWindow, currentWindow] = await Promise.all([
    browser.windows.getLastFocused({
      windowTypes: ['normal'],
    } as Windows.GetInfo),
    browser.windows.getLastFocused(),
  ]);
  const { top: cTop, left: cLeft, width, height } = normalWindow;

  const top = cTop;
  const left = cLeft! + width! - WINDOW_SIZE.width;
  const optionHeight = rest.height || 600;
  const maxHeight = (height || 1000) - 40;
  const finalHeight = Math.min(optionHeight, Math.max(maxHeight, 600));

  let win;
  if (currentWindow.state === 'fullscreen') {
    // browser.windows.create not pass state to chrome
    win = await createFullScreenWindow({ url, ...rest });
  } else {
    try {
      win = await browser.windows.create({
        focused: true,
        url,
        type: 'popup',
        top,
        left,
        ...WINDOW_SIZE,
        ...rest,
        height: finalHeight,
      });
    } catch (e) {
      if (e.message && /Invalid value for bound/i.test(e.message)) {
        win = await browser.windows.create({
          focused: true,
          url,
          type: 'popup',
          top: 0,
          left: 0,
          ...WINDOW_SIZE,
          ...rest,
          height: finalHeight,
        });
      } else {
        Sentry.captureException(`tx prompt error: ${JSON.stringify(e)}`);
      }
    }
  }
  if (!win) return;

  // shim firefox
  if (win.left !== left && currentWindow.state !== 'fullscreen') {
    try {
      await browser.windows.update(win.id!, { left, top });
    } catch (e) {
      // nothing to do, just avoid error prevent id response
    }
  }

  return win.id;
};

const remove = async (winId) => {
  return browser.windows.remove(winId);
};

const openNotification = async ({ route = '', ...rest } = {}): Promise<
  number | undefined
> => {
  // Mint a single-use close token and deliver it ONLY inside this window's
  // own URL. The closeNotification handler requires it, so only a script
  // running inside THIS notification window can announce a non-manual close
  // for it (see the header comment above).
  const closeNonce = uuidv4();
  const url = `notification.html?closeNonce=${closeNonce}${
    route ? `#${route}` : ''
  }`;

  const winId = await create({ url, ...rest });
  if (winId !== undefined) {
    closeNotificationNonces.set(closeNonce, winId);
  }
  return winId;
};

export default {
  openNotification,
  event,
  remove,
};
