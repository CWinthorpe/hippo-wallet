import { ethErrors } from 'eth-rpc-errors';
import {
  keyringService,
  notificationService,
  permissionService,
  preferenceService,
} from 'background/service';
import {
  captureAuthorityContext,
  setCurrentAccountWithBoundary,
} from 'background/service/sessionBoundary';
import type { AuthorityContext } from 'background/service/sessionBoundary';
import { PromiseFlow, underline2Camelcase } from 'background/utils';
import {
  EVENTS,
  INTERNAL_REQUEST_ORIGIN,
  KEYRING_CLASS,
  KEYRING_TYPE,
  SUPPORT_1559_KEYRING_TYPE,
} from 'consts';
import providerController from './controller';
import eventBus from '@/eventBus';
import { resemblesETHAddress } from '@/utils';
import { ProviderRequest } from './type';
import * as Sentry from '@sentry/browser';
import stats from '@/stats';
import { sha256 } from '@noble/hashes/sha256';
import {
  addHexPrefix,
  bytesToHex,
  intToHex,
  stripHexPrefix,
} from '@ethereumjs/util';
import { findChain } from '@/utils/chain';
import { waitSignComponentAmounted } from '@/utils/signEvent';
import { gnosisController } from './gnosisController';
import { bgRetryTxMethods } from '@/background/utils/errorTxRetry';
import { hexToNumber } from 'viem';
import BigNumber from 'bignumber.js';
import { ga4 } from '@/utils/ga4';
import {
  buildSignTx,
  normalizeTxParams,
  shouldUpdateNonce,
} from '@/utils/transaction';
import type { Tx } from 'background/service/openapi';
import {
  cancelSignTxPreparation,
  startSignTxPreparation,
} from '@/background/service/signTxPreparation';
import { v4 as uuidv4 } from 'uuid';
import { isSigningCarrierReported, takeSigningCarrier } from '@/utils/sentry';

const isSignApproval = (type: string) => {
  const SIGN_APPROVALS = ['SignText', 'SignTypedData', 'SignTx'];
  return SIGN_APPROVALS.includes(type);
};

const lockedOrigins = new Set<string>();
const connectOrigins = new Set<string>();

const getScreenAvailHeight = async () => {
  return 1000;
};

const flow = new PromiseFlow<{
  request: ProviderRequest & {
    session: Exclude<ProviderRequest, void>;
  };
  mapMethod: string;
  approvalRes: any;
  /** Approval-queue epoch captured when this request's approval was queued. */
  approvalEpochAtRequest?: number;
  /** Per-origin session-boundary epoch captured alongside it. */
  originEpochAtRequest?: number;
  /** Account identity the user approved against (null = none bound). */
  boundAccount?: {
    address: string;
    type?: string;
    brandName?: string;
  } | null;
  /** Origin chain identity bound at approval time (undefined = not bound). */
  boundChain?: string;
}>();

/**
 * Sink-adjacent revalidation shared by the two points immediately before the
 * privileged handler runs (and before the signing-component wait, and again
 * right after it resolves). Every trust boundary that can fire between
 * approval resolution and signature/broadcast execution — lock, site-account
 * reassignment, account switch, chain switch, permission revocation, worker
 * teardown — must make the continuation fail closed with a user-rejected
 * result, never sign with pre-boundary authority.
 */
const assertSignContextStillValid = (params: {
  origin: string;
  epochAtRequest: number | undefined;
  originEpochAtRequest: number | undefined;
  boundAccount:
    | { address: string; type?: string; brandName?: string }
    | null
    | undefined;
  boundChain: string | undefined;
  internalOrigin: boolean;
  /**
   * Chain-switch/AddChain approvals legitimately mutate the site's chain and
   * other identity state as PART of resolving their own approval, so the
   * identity (account/chain) comparison only applies to signing requests.
   * Session/permission epochs are checked regardless.
   */
  checkIdentity: boolean;
}) => {
  const {
    origin,
    epochAtRequest,
    originEpochAtRequest,
    boundAccount,
    boundChain,
    internalOrigin,
    checkIdentity,
  } = params;

  const rejected = (message: string) => {
    throw ethErrors.provider.userRejectedRequest({ message });
  };

  // Wallet lock is the strongest boundary: never sign against a locked vault.
  if (!keyringService.memStore.getState().isUnlocked) {
    rejected('Wallet was locked while the request was pending; approve again.');
  }
  // Global session boundary (lock, account switch, reset, teardown) bumps the
  // approval epoch; a resolved-but-unexecuted request dies with it.
  if (
    epochAtRequest !== undefined &&
    notificationService.approvalEpoch !== epochAtRequest
  ) {
    rejected(
      'Session context changed while the request was pending; approve again.'
    );
  }
  // Origin-scoped boundary (site-account reassignment, chain switch,
  // disconnect) invalidates this origin's consent even though other origins
  // keep their generation.
  if (
    originEpochAtRequest !== undefined &&
    notificationService.getOriginApprovalEpoch(origin) !== originEpochAtRequest
  ) {
    rejected(
      'Connection context for this site changed while the request was pending; approve again.'
    );
  }
  // The connection that was approved must still exist.
  if (!permissionService.hasPermission(origin)) {
    rejected(
      'Connection for this site was revoked while the request was pending.'
    );
  }

  if (internalOrigin || !checkIdentity) {
    // Internal UI requests carry their account explicitly; global boundaries
    // above already cover account/lock transitions for them. Non-sign
    // approvals (chain switch, add-chain) mutate identity as their payload.
    return;
  }

  // The account the approval rendered for must still be the effective
  // account for this origin (dapp-account mode resolves through the site's
  // account, otherwise the wallet's current account is used).
  if (boundAccount) {
    const site = permissionService.getConnectedSite(origin);
    const liveAccount =
      (preferenceService.getPreference('isEnabledDappAccount') && site
        ? site.account || preferenceService.getCurrentAccount()
        : preferenceService.getCurrentAccount()) || null;
    if (
      !liveAccount ||
      String(liveAccount.address).toLowerCase() !== boundAccount.address ||
      liveAccount.type !== boundAccount.type ||
      liveAccount.brandName !== boundAccount.brandName
    ) {
      rejected(
        'The active account changed while the request was pending; approve again.'
      );
    }
  }

  // The origin's active chain must still be the one the approval rendered
  // against.
  if (boundChain) {
    const liveChain = permissionService.getConnectedSite(origin)?.chain;
    if (liveChain !== boundChain) {
      rejected(
        'The active chain for this site changed while the request was pending; approve again.'
      );
    }
  }
};
const flowContext = flow
  .use(async (ctx, next) => {
    // check method
    const {
      data: { method },
    } = ctx.request;
    ctx.mapMethod = underline2Camelcase(method);
    if (Reflect.getMetadata('PRIVATE', providerController, ctx.mapMethod)) {
      // Reject when dapp try to call private controller function
      throw ethErrors.rpc.methodNotFound({
        message: `method [${method}] doesn't has corresponding handler`,
        data: ctx.request.data,
      });
    }
    if (!providerController[ctx.mapMethod]) {
      // TODO: make rpc whitelist
      if (method.startsWith('eth_') || method === 'net_version') {
        return providerController.ethRpc(ctx.request);
      }

      throw ethErrors.rpc.methodNotFound({
        message: `method [${method}] doesn't has corresponding handler`,
        data: ctx.request.data,
      });
    }

    return next();
  })
  .use(async (ctx, next) => {
    const {
      mapMethod,
      request: {
        session: { origin },
        data,
      },
    } = ctx;

    if (!Reflect.getMetadata('SAFE', providerController, mapMethod)) {
      // check lock
      const isUnlock = keyringService.memStore.getState().isUnlocked;
      const isConnected = permissionService.hasPermission(origin);
      const hasOtherProvider = !!data?.$ctx?.providers?.length;

      /**
       * if not connected and has other provider ignore lock check
       */
      if (!isConnected && hasOtherProvider) {
        return next();
      }
      if (!isUnlock) {
        if (lockedOrigins.has(origin)) {
          throw ethErrors.rpc.resourceNotFound(
            'Already processing unlock. Please wait.'
          );
        }
        ctx.request.requestedApproval = true;
        lockedOrigins.add(origin);
        try {
          await notificationService.requestApproval(
            { lock: true, approvalComponent: 'Unlock' },
            { height: 628 }
          );
          lockedOrigins.delete(origin);
        } catch (e) {
          lockedOrigins.delete(origin);
          throw e;
        }
      }
    }

    return next();
  })
  .use(async (ctx, next) => {
    // check connect
    const {
      request: {
        session: { origin, name, icon },
        data,
      },
      mapMethod,
    } = ctx;
    if (!Reflect.getMetadata('SAFE', providerController, mapMethod)) {
      if (!permissionService.hasPermission(origin)) {
        if (connectOrigins.has(origin)) {
          throw ethErrors.rpc.resourceNotFound(
            'Already processing connect. Please wait.'
          );
        }
        ctx.request.requestedApproval = true;
        connectOrigins.add(origin);

        try {
          const isUnlock = keyringService.memStore.getState().isUnlocked;

          const {
            defaultChain,
            defaultAccount,
          } = await notificationService.requestApproval(
            {
              params: { origin, name, icon, $ctx: data.$ctx },
              account: ctx.request.account,
              approvalComponent: 'Connect',
            },
            { height: isUnlock ? 800 : 628 }
          );

          const isEnabledDappAccount = preferenceService.getPreference(
            'isEnabledDappAccount'
          );

          if (!isEnabledDappAccount) {
            setCurrentAccountWithBoundary(defaultAccount!);
          }
          connectOrigins.delete(origin);
          permissionService.addConnectedSiteV2({
            origin,
            name,
            icon,
            defaultChain,
            defaultAccount: isEnabledDappAccount
              ? defaultAccount || preferenceService.getCurrentAccount()
              : undefined,
          });
          ctx.request.account =
            defaultAccount || preferenceService.getCurrentAccount();

          ga4.fireEvent('Dapp_Connected', {
            event_category: 'Dapp Usage',
            event_label: origin,
          });
        } catch (e) {
          console.error(e);
          connectOrigins.delete(origin);
          throw e;
        }
      }
    }

    return next();
  })
  .use(async (ctx, next) => {
    // check need approval
    const {
      request: {
        data: { params, method },
        session: { origin, name, icon, isFromRabby },
      },
      mapMethod,
    } = ctx;

    const [approvalType, condition, options = {}] =
      Reflect.getMetadata('APPROVAL', providerController, mapMethod) || [];

    let windowHeight = 800;
    if ('height' in options) {
      windowHeight = options.height;
    } else {
      const minHeight = 500;
      const screenAvailHeight = await getScreenAvailHeight();
      if (screenAvailHeight < 880) {
        windowHeight = screenAvailHeight;
      }
      if (windowHeight < minHeight) {
        windowHeight = minHeight;
      }
    }
    if (approvalType === 'SignText') {
      let from, message;
      const [first, second] = params;
      // Compatible with wrong params order
      // ref: https://github.com/MetaMask/eth-json-rpc-middleware/blob/53c7361944c380e011f5f4ee1e184db746e26d73/src/wallet.ts#L284
      if (resemblesETHAddress(first) && !resemblesETHAddress(second)) {
        from = first;
        message = second;
      } else {
        from = second;
        message = first;
      }
      const hexReg = /^[0-9A-Fa-f]+$/gu;
      const stripped = stripHexPrefix(message);
      if (stripped.match(hexReg)) {
        message = addHexPrefix(stripped);
      }
      ctx.request.data.params[0] = message;
      ctx.request.data.params[1] = from;
    }
    if (approvalType && (!condition || !condition(ctx.request))) {
      ctx.request.requestedApproval = true;
      if (approvalType === 'SignTx' && !('chainId' in params[0])) {
        const site = permissionService.getConnectedSite(origin);
        if (site) {
          const chain = findChain({
            enum: site.chain,
          });
          if (chain) {
            params[0].chainId = chain.id;
          }
        }
      }

      const approvalCtx = ctx?.request?.data?.$ctx;
      // `params` is not always a tx array - wallet_watchAsset passes an object,
      // so params[0] must only be read on the SignTx path.
      const signTx = approvalType === 'SignTx' ? params[0] : undefined;
      // SignTx renders and signs the dapp-normalized tx, so the preparation
      // has to read its intent flags from that same copy - reading them off
      // the raw dapp params lets a dapp set isSpeedUp/isSend and steer the
      // prepared nonce and gas level. Normalizing can throw on malformed
      // numeric input; that must only skip the preparation, never reject the
      // approval the user would otherwise see.
      let normalizedSignTx: (Tx & Record<string, any>) | undefined;
      try {
        normalizedSignTx = signTx
          ? (normalizeTxParams(
              { ...signTx },
              !isFromRabby && origin !== INTERNAL_REQUEST_ORIGIN
            ) as Tx & Record<string, any>)
          : undefined;
      } catch (e) {
        Sentry.captureException(e);
      }
      const hasEip7702Authorization = Boolean(
        (Array.isArray(signTx?.authorizationList) &&
          signTx.authorizationList.length > 0) ||
          approvalCtx?.eip7702Revoke ||
          approvalCtx?.eip7702RevokeAuthorization
      );
      const signTxChain = signTx
        ? findChain({ id: Number(signTx.chainId) })
        : undefined;
      const isSafeAccount =
        ctx.request.account?.type === KEYRING_TYPE.GnosisKeyring ||
        ctx.request.account?.type === KEYRING_TYPE.CoboArgusKeyring;
      // SignTx sends its own parse/pre-exec requests with the approval
      // account's address, not the dapp-supplied `from`, so the preparation
      // has to use the same one or the two describe the request differently.
      const preparationAddress = ctx.request.account?.address;
      const canPrepareNonce = normalizedSignTx
        ? shouldUpdateNonce({
            nonce: normalizedSignTx.nonce,
            from: normalizedSignTx.from,
            to: normalizedSignTx.to,
            isSpeedUp: normalizedSignTx.isSpeedUp,
            isCancel: normalizedSignTx.isCancel,
          }) || normalizedSignTx.nonce != null
        : false;
      let signTxPreparationId: string | undefined;
      // Session boundary checkpoint: captured when this request's approval
      // enters the queue; revalidated after the approval resolves (below).
      let epochAtRequest = 0;
      if (
        signTx &&
        normalizedSignTx &&
        preparationAddress &&
        signTxChain &&
        !signTxChain.isTestnet &&
        !isSafeAccount &&
        canPrepareNonce &&
        !hasEip7702Authorization
      ) {
        signTxPreparationId = uuidv4();
      }
      try {
        const operationId = uuidv4();
        const requestDigest = bytesToHex(
          sha256(
            new TextEncoder().encode(
              JSON.stringify({
                method,
                params: ctx.request.data.params,
              })
            )
          )
        );
        const approvalData = {
          approvalComponent: approvalType,
          params: {
            $ctx: approvalCtx,
            method,
            data: ctx.request.data.params,
            session: { origin, name, icon, isFromRabby },
          },
          account: ctx.request.account,
          origin,
        };
        // Session-boundary checkpoint: capture the approval lifecycle epoch
        // before the request leaves the queue. If a boundary (lock, account
        // switch, reset, WindowConnect teardown, site-account reassignment,
        // chain switch, permission revocation) fires while the approval is
        // pending OR after it resolved but before the sink, the epoch check
        // makes the continuation fail closed instead of executing with
        // pre-boundary authority. The epoch is also stashed on the flow
        // context so the sink-adjacent recheck (next middleware) can repeat
        // it after the signing-component wait.
        epochAtRequest = notificationService.approvalEpoch;
        ctx.approvalEpochAtRequest = epochAtRequest;
        ctx.originEpochAtRequest = notificationService.getOriginApprovalEpoch(
          origin
        );
        // Bind the identity the user approved against: the request account
        // and the origin's active chain at approval time. The sink-adjacent
        // recheck compares live state against this binding. It is kept on the
        // flow context rather than inside `approvalRes` because approvalRes is
        // spread into the tx payload downstream — security bindings must not
        // ride into signed/broadcast data.
        ctx.boundAccount = ctx.request.account
          ? {
              address: String(ctx.request.account.address).toLowerCase(),
              type: ctx.request.account.type,
              brandName: ctx.request.account.brandName,
            }
          : null;
        ctx.boundChain = permissionService.isInternalOrigin(origin)
          ? undefined
          : permissionService.getConnectedSite(origin)?.chain;
        const authorityContext = captureAuthorityContext({
          origin,
          boundAccount: ctx.request.account || null,
          boundChain: ctx.boundChain,
          internalOrigin: permissionService.isInternalOrigin(origin),
          operationId,
          requestDigest,
          approvalComponent: approvalType,
        });
        ctx.request.authorityContext = authorityContext;
        (approvalData.params as any).$signingContext = authorityContext;
        const approvalPromise = notificationService.requestApproval(
          approvalData,
          { height: windowHeight },
          {
            onCurrent: () => {
              if (
                !signTxPreparationId ||
                !signTx ||
                !normalizedSignTx ||
                !preparationAddress ||
                !signTxChain
              ) {
                return;
              }
              Object.assign(approvalData.params, { signTxPreparationId });
              startSignTxPreparation({
                id: signTxPreparationId,
                // must match how SignTx builds the tx it renders and signs -
                // the prepared pre-exec result is shown as that tx's asset
                // change. enable7702 is always false here, preparation is
                // skipped for any 7702 authorization.
                tx: buildSignTx({
                  tx: normalizedSignTx,
                  chainId: Number(signTx.chainId),
                  gasLimit: normalizedSignTx.gasLimit,
                }),
                origin,
                address: preparationAddress,
                chainId: Number(signTx.chainId),
                support1559:
                  signTxChain.eip['1559'] &&
                  SUPPORT_1559_KEYRING_TYPE.includes(
                    ctx.request.account?.type as any
                  ),
                delegateCall:
                  Boolean(normalizedSignTx.operation) &&
                  ctx.request.account?.type === KEYRING_TYPE.GnosisKeyring,
                isSpeedUp: normalizedSignTx.isSpeedUp,
                isCancel: normalizedSignTx.isCancel,
                isSend: normalizedSignTx.isSend,
                isSwap: normalizedSignTx.isSwap,
                isBridge: normalizedSignTx.isBridge,
              });
            },
          }
        );

        ctx.approvalRes = await approvalPromise;
      } finally {
        if (signTxPreparationId) {
          cancelSignTxPreparation(signTxPreparationId);
        }
      }

      // Post-approval session-boundary revalidation: the approval resolved
      // against the epochs and identity captured above. If any boundary
      // (lock, account switch, reset, teardown, supported-chain switch,
      // site-account reassignment, permission revocation) fired between
      // queuing and continuation, the request must fail closed instead of
      // executing with pre-boundary authority.
      assertSignContextStillValid({
        origin,
        epochAtRequest,
        originEpochAtRequest: ctx.originEpochAtRequest,
        boundAccount: ctx.boundAccount,
        boundChain: ctx.boundChain,
        internalOrigin: permissionService.isInternalOrigin(origin),
        checkIdentity: isSignApproval(approvalType),
      });

      if (isSignApproval(approvalType)) {
        permissionService.updateConnectSite(origin, { isSigned: true }, true);
      } else {
        permissionService.touchConnectedSite(origin);
      }
    }

    return next();
  })
  .use(async (ctx) => {
    const { approvalRes, mapMethod, request } = ctx;
    // process request
    const [approvalType] =
      Reflect.getMetadata('APPROVAL', providerController, mapMethod) || [];
    const { uiRequestComponent, ...rest } = approvalRes || {};
    const {
      session: { origin },
    } = request;

    const createRequestDeferFn = (
      originApprovalRes: typeof approvalRes
    ) => async (isRetry = false) =>
      new Promise((resolve, reject) => {
        let waitSignComponentPromise = Promise.resolve();

        if (isSignApproval(approvalType) && uiRequestComponent) {
          const approvalId = originApprovalRes?.__approvalId;
          if (!approvalId) {
            return reject(
              ethErrors.provider.userRejectedRequest({
                message: 'Missing approval binding; approve again.',
              })
            );
          }
          waitSignComponentPromise = waitSignComponentAmounted({
            approvalId,
            approvalComponent: approvalType,
            authorityContext: ctx.request.authorityContext!,
          });
        }

        // if (approvalRes?.isGnosis && !approvalRes.safeMessage) {
        //   return resolve(undefined);
        // }
        if (originApprovalRes?.isGnosis) {
          return resolve(undefined);
        }

        return waitSignComponentPromise.then(() => {
          // Sink-adjacent recheck: the signing-component / hardware-wallet
          // wait just resolved and the privileged handler executes on this
          // tick. Any trust boundary that fired DURING the wait (lock, chain
          // switch, site-account reassignment, revocation, worker teardown)
          // must reject here with zero handler execution. The rejection is
          // routed through `reject` so the outer defer promise settles to the
          // dApp instead of hanging on an unhandled rejection.
          if (isSignApproval(approvalType)) {
            try {
              assertSignContextStillValid({
                origin,
                epochAtRequest: ctx.approvalEpochAtRequest,
                originEpochAtRequest: ctx.originEpochAtRequest,
                boundAccount: ctx.boundAccount,
                boundChain: ctx.boundChain,
                internalOrigin: permissionService.isInternalOrigin(origin),
                checkIdentity: true,
              });
            } catch (boundaryError) {
              return reject(boundaryError);
            }
          }

          let _approvalRes = originApprovalRes;

          if (
            isRetry &&
            approvalType === 'SignTx' &&
            mapMethod === 'ethSendTransaction'
          ) {
            _approvalRes = { ...originApprovalRes };
            const {
              getRetryTxType,
              getRetryTxRecommendNonce,
            } = bgRetryTxMethods;
            const retryType = getRetryTxType();
            switch (retryType) {
              case 'nonce': {
                const recommendNonce = getRetryTxRecommendNonce();
                if (recommendNonce === _approvalRes.nonce) {
                  _approvalRes.nonce = intToHex(
                    hexToNumber(recommendNonce as '0x${string}') + 1
                  );
                } else {
                  _approvalRes.nonce = recommendNonce;
                }

                break;
              }

              case 'gasPrice': {
                if (_approvalRes.gasPrice) {
                  _approvalRes.gasPrice = `0x${new BigNumber(
                    new BigNumber(_approvalRes.gasPrice, 16)
                      .times(1.3)
                      .toFixed(0)
                  ).toString(16)}`;
                }
                if (_approvalRes.maxFeePerGas) {
                  _approvalRes.maxFeePerGas = `0x${new BigNumber(
                    new BigNumber(_approvalRes.maxFeePerGas, 16)
                      .times(1.3)
                      .toFixed(0)
                  ).toString(16)}`;
                }
                break;
              }

              default:
                break;
            }
            if (retryType) {
              if (!approvalRes?.isGnosis) {
                notificationService.setCurrentRequestDeferFn(
                  createRequestDeferFn(_approvalRes),
                  _approvalRes?.__approvalId
                );
              }
            }
          }

          return Promise.resolve(
            providerController[mapMethod]({
              ...request,
              approvalRes: _approvalRes,
            })
          )
            .then((result) => {
              if (isSignApproval(approvalType)) {
                eventBus.emit(EVENTS.broadcastToUI, {
                  method: EVENTS.SIGN_FINISHED,
                  params: {
                    success: true,
                    data: result,
                    approvalId: originApprovalRes?.__approvalId,
                    approvalComponent: approvalType,
                    authorityContext: ctx.request.authorityContext,
                  },
                });
              }
              return result;
            })
            .then(resolve)
            .catch((e: any) => {
              console.error(e);
              const payload = {
                method: EVENTS.SIGN_FINISHED,
                params: {
                  success: false,
                  errorMsg: e?.message || JSON.stringify(e),
                  approvalId: originApprovalRes?.__approvalId,
                  approvalComponent: approvalType,
                  authorityContext: ctx.request.authorityContext,
                },
              };
              if (e.method) {
                payload.method = e.method;
                payload.params = e.message;
              }

              const signingCarrier = takeSigningCarrier(e);
              if (signingCarrier) {
                if (!isSigningCarrierReported(signingCarrier)) {
                  Sentry.captureException(signingCarrier);
                }
              } else if (
                !isSignApproval(approvalType) ||
                (e && typeof e === 'object')
              ) {
                Sentry.captureException(e);
              }
              if (isSignApproval(approvalType)) {
                eventBus.emit(EVENTS.broadcastToUI, payload);
              }
              reject(e);
            });
        });
      });

    const requestDeferFn = createRequestDeferFn(approvalRes);

    if (!approvalRes?.isGnosis) {
      // Defer ownership: revokeSigningOperation clears it when the owning
      // (parent) approval is rejected/closed (gpt56 round-10 blocker 1).
      notificationService.setCurrentRequestDeferFn(
        requestDeferFn,
        approvalRes?.__approvalId
      );
    }
    const requestDefer = requestDeferFn();
    // The uiRequestComponent branch below answers the dApp from the approval
    // loop instead of consuming this deferred promise, so a failure inside
    // the deferred path (e.g. the sink-adjacent boundary reject) would be an
    // unhandled rejection on the service worker. Keep the rejection observable
    // to whoever awaits requestDefer, without crashing the worker.
    requestDefer.catch(() => undefined);
    async function requestApprovalLoop({
      uiRequestComponent,
      $account,
      ...rest
    }) {
      ctx.request.requestedApproval = true;
      const res = await notificationService.requestApproval({
        approvalComponent: uiRequestComponent,
        params: rest,
        account: $account,
        origin,
        approvalType,
        isUnshift: true,
      });
      if (res?.uiRequestComponent) {
        return await requestApprovalLoop(res);
      } else {
        return res;
      }
    }

    if (uiRequestComponent) {
      ctx.request.requestedApproval = true;
      const result = await requestApprovalLoop({ uiRequestComponent, ...rest });
      // The UI-component round trip is another window in which boundaries
      // can fire. The approval queue rejects pending approvals across those
      // boundaries; this recheck closes the remaining edge where a boundary
      // and a resolve race each other, so the dApp-facing artifact is never
      // returned after a transition.
      if (isSignApproval(approvalType)) {
        assertSignContextStillValid({
          origin,
          epochAtRequest: ctx.approvalEpochAtRequest,
          originEpochAtRequest: ctx.originEpochAtRequest,
          boundAccount: ctx.boundAccount,
          boundChain: ctx.boundChain,
          internalOrigin: permissionService.isInternalOrigin(origin),
          checkIdentity: true,
        });
      }
      reportStatsData();
      if (rest?.safeMessage) {
        const safeMessage: {
          safeAddress: string;
          message: string | Record<string, any>;
          chainId: number;
          safeMessageHash: string;
        } = rest.safeMessage;
        if (ctx.request.requestedApproval) {
          flow.requestedApproval = false;
          // only unlock notification if current flow is an approval flow
          notificationService.unLock();
        }
        return gnosisController.watchMessage({
          address: safeMessage.safeAddress,
          chainId: safeMessage.chainId,
          safeMessageHash: safeMessage.safeMessageHash,
        });
      } else {
        return result;
      }
    }

    return requestDefer;
  })
  .callback();

function reportStatsData() {
  const statsData = notificationService.getStatsData();

  if (!statsData || statsData.reported) return;

  if (statsData?.signed) {
    const sData: any = {
      type: statsData?.type,
      chainId: statsData?.chainId,
      category: statsData?.category,
      success: statsData?.signedSuccess,
      preExecSuccess: statsData?.preExecSuccess,
      createdBy: statsData?.createdBy,
      source: statsData?.source,
      trigger: statsData?.trigger,
      networkType: statsData?.networkType,
    };
    if (statsData.signMethod) {
      sData.signMethod = statsData.signMethod;
    }
    stats.report('signedTransaction', sData);
  }
  if (statsData?.submit) {
    stats.report('submitTransaction', {
      type: statsData?.type,
      chainId: statsData?.chainId,
      category: statsData?.category,
      success: statsData?.submitSuccess,
      preExecSuccess: statsData?.preExecSuccess,
      createdBy: statsData?.createdBy,
      source: statsData?.source,
      trigger: statsData?.trigger,
      networkType: statsData?.networkType || '',
    });
  }

  statsData.reported = true;

  notificationService.setStatsData(statsData);
}

export default (request: ProviderRequest) => {
  const ctx: any = {
    request: { ...request, requestedApproval: false },
  };
  notificationService.setStatsData();
  return flowContext(ctx).finally(() => {
    reportStatsData();

    if (ctx.request.requestedApproval) {
      flow.requestedApproval = false;
      // only unlock notification if current flow is an approval flow
      notificationService.unLock();
    }
  });
};
