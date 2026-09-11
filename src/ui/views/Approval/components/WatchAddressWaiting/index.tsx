import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matomoRequestEvent } from '@/utils/matomo-request';
import { Account } from 'background/service/preference';
import {
  CHAINS,
  WALLETCONNECT_STATUS_MAP,
  EVENTS,
  KEYRING_CATEGORY_MAP,
  CHAINS_ENUM,
} from 'consts';
import { useApproval, useCommonPopupView, useWallet } from 'ui/utils';
import eventBus from '@/eventBus';
import { createWalletConnectReadinessAck } from '@/ui/utils/wcInitAck';
import type { WcAckHandle } from '@/ui/utils/wcInitAck';
import Process from './Process';
import Scan from './Scan';
import { message } from 'antd';
import { useSessionStatus } from '@/ui/component/WalletConnect/useSessionStatus';
import { adjustV } from '@/ui/utils/gnosis';
import { findChain, findChainByEnum } from '@/utils/chain';
import {
  emitSignComponentAmounted,
  createSignEventConsumer,
} from '@/utils/signEvent';
import { ga4 } from '@/utils/ga4';

interface ApprovalParams {
  address: string;
  chainId?: number;
  nonce?: string;
  from?: string;
  isGnosis?: boolean;
  data?: string[];
  account?: Account;
  $ctx?: any;
  extra?: Record<string, any>;
  signingTxId?: string;
  safeMessage?: {
    safeMessageHash: string;
    safeAddress: string;
    message: string;
    chainId: number;
  };
  stay?: boolean;
}

const WatchAddressWaiting = ({
  params,
  account: $account,
}: {
  params: ApprovalParams;
  account: Account;
}) => {
  const { setHeight, setVisible, closePopup } = useCommonPopupView();
  const wallet = useWallet();
  const [connectStatus, setConnectStatus] = useState(
    WALLETCONNECT_STATUS_MAP.WAITING
  );
  const [connectError, setConnectError] = useState<null | {
    code?: number;
    message?: string;
  }>(null);
  const [qrcodeContent, setQrcodeContent] = useState('');
  const [result, setResult] = useState('');
  const [
    getApproval,
    resolveApproval,
    rejectApproval,
    getApprovalBinding,
  ] = useApproval();
  const chain =
    findChain({
      id: params.chainId || 1,
    })?.enum || CHAINS_ENUM.ETH;
  const isSignTextRef = useRef(false);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const explainRef = useRef<any | null>(null);
  const [signFinishedData, setSignFinishedData] = useState<{
    data: any;
    approvalId: string;
  }>();
  const [isClickDone, setIsClickDone] = useState(false);
  const { status: sessionStatus } = useSessionStatus(currentAccount!);
  const { t } = useTranslation();

  // gpt56 round-10 blocker 5: track every WalletConnect listener this
  // component registers so retry/refresh/unmount can remove them, and hold
  // the current initialization-acknowledgement handle for abort-on-retry.
  const wcListenersRef = useRef<
    Array<{ event: string; handler: (payload: any) => void }>
  >([]);
  const ackHandleRef = useRef<WcAckHandle | null>(null);
  const addTrackedWcListener = (
    event: string,
    handler: (payload: any) => void
  ) => {
    eventBus.addEventListener(event, handler);
    wcListenersRef.current.push({ event, handler });
  };
  const removeTrackedWcListeners = () => {
    wcListenersRef.current.forEach(({ event, handler }) =>
      eventBus.removeEventListener(event, handler)
    );
    wcListenersRef.current = [];
  };

  const initWalletConnect = async (): Promise<boolean> => {
    const account = params.isGnosis ? params.account! : $account;
    const status = await wallet.getWalletConnectStatus(
      account.address,
      account.brandName
    );
    if (status) {
      setConnectStatus(
        status === null ? WALLETCONNECT_STATUS_MAP.PENDING : status
      );
    }
    // Replace (not accumulate) the pairing-URI display listener across
    // retries/refreshes: remove the previously tracked INITED handler first
    // so repeated initWalletConnect() calls never stack listeners.
    wcListenersRef.current
      .filter(({ event }) => event === EVENTS.WALLETCONNECT.INITED)
      .forEach(({ event, handler }) =>
        eventBus.removeEventListener(event, handler)
      );
    wcListenersRef.current = wcListenersRef.current.filter(
      ({ event }) => event !== EVENTS.WALLETCONNECT.INITED
    );
    addTrackedWcListener(EVENTS.WALLETCONNECT.INITED, ({ uri }) => {
      setQrcodeContent(uri);
    });
    const signingTx = await wallet.getSigningTx(params.signingTxId!);

    explainRef.current = signingTx?.explain;
    if (
      status === WALLETCONNECT_STATUS_MAP.CONNECTED ||
      status === WALLETCONNECT_STATUS_MAP.SUBMITTED
    ) {
      // Already paired: the status itself is the readiness acknowledgement.
      return true;
    }

    // gpt56 round-10 blocker 5: await an explicit acknowledgement (pairing
    // URI via INITED, or CONNECTED/SUBMITTED status) before reporting
    // readiness. Failure or timeout returns false so the caller must NOT
    // announce the signing component.
    ackHandleRef.current?.abort();
    const ack = createWalletConnectReadinessAck({
      events: {
        inited: EVENTS.WALLETCONNECT.INITED,
        statusChanged: EVENTS.WALLETCONNECT.STATUS_CHANGED,
      },
      statusMap: WALLETCONNECT_STATUS_MAP,
      addListener: (event, handler) => addTrackedWcListener(event, handler),
      removeListener: (event, handler) =>
        eventBus.removeEventListener(event, handler),
      kickInit: () =>
        eventBus.emit(EVENTS.broadcastToBackground, {
          method: EVENTS.WALLETCONNECT.INIT,
          data: account,
        }),
    });
    ackHandleRef.current = ack;
    try {
      await ack.promise;
      return true;
    } catch (e: any) {
      setConnectStatus(WALLETCONNECT_STATUS_MAP.FAILED);
      setConnectError({ message: String(e?.message || e) });
      return false;
    }
  };

  const handleCancel = () => {
    rejectApproval('user cancel');
  };

  const handleRetry = async (retry?: boolean) => {
    setConnectStatus(WALLETCONNECT_STATUS_MAP.WAITING);
    setConnectError(null);
    // gpt56 round-10 blocker 5: retry re-initializes the connector BEFORE
    // re-driving the signing request; a failed re-init never re-announces.
    const ready = await initWalletConnect();
    if (!ready) {
      return;
    }
    wallet.resendSign(retry);
    message.success(t('page.signFooterBar.walletConnect.requestSuccessToast'));
    emitSignComponentAmounted(getApprovalBinding());
  };

  const handleRefreshQrCode = () => {
    void initWalletConnect();
  };

  const signFinishedHandlerRef = useRef<((data: any) => Promise<void>) | null>(
    null
  );
  const init = async () => {
    const approval = await getApproval();
    const account = params.isGnosis ? params.account! : $account;

    setCurrentAccount(account);

    let isSignTriggered = false;
    const isText = params.isGnosis
      ? true
      : approval?.data.approvalType !== 'SignTx';
    isSignTextRef.current = isText;

    const signConsumer = createSignEventConsumer(getApprovalBinding);
    const signFinishedHandler = async (data) => {
      if (!signConsumer.tryConsume(data)) {
        return;
      }
      // Terminal (success) consumption: detach synchronously BEFORE any
      // await/effect so a duplicated or replayed completion can never run
      // the irreversible Gnosis/Cobo branch twice (gpt56 round-9 blocker 3).
      // Failures keep the listener for the legitimate resend flow.
      if (signConsumer.isTerminal(data)) {
        eventBus.removeEventListener(EVENTS.SIGN_FINISHED, signFinishedHandler);
      }
      if (data.success) {
        let sig = data.data;
        setResult(sig);
        try {
          if (params.isGnosis) {
            sig = adjustV('eth_signTypedData', sig);
            const safeMessage = params.safeMessage;
            if (safeMessage) {
              await wallet.handleGnosisMessage({
                signature: data.data,
                signerAddress: params.account!.address!,
                authorityContext: data.authorityContext,
              });
            } else {
              const sigs = await wallet.getGnosisTransactionSignatures();
              if (sigs.length > 0) {
                await wallet.gnosisAddConfirmation(
                  account.address,
                  sig,
                  data.authorityContext
                );
              } else {
                await wallet.gnosisAddSignature(
                  account.address,
                  sig,
                  data.authorityContext
                );
                await wallet.postGnosisTransaction(data.authorityContext);
              }
            }
          }
        } catch (e) {
          rejectApproval(e.message);
          return;
        }
        if (!isSignTextRef.current) {
          // const tx = approval.data?.params;
          const explain = explainRef.current;
          if (explain) {
            // const { nonce, from, chainId } = tx;
            // const explain = await wallet.getExplainCache({
            //   nonce: Number(nonce),
            //   address: from,
            //   chainId: Number(chainId),
            // });
            //   wallet.reportStats('signedTransaction', {
            //     type: account.brandName,
            //     chainId: findChainByEnum(chain)?.serverId || '',
            //     category: KEYRING_CATEGORY_MAP[account.type],
            //     success: true,
            //     preExecSuccess: explain
            //       ? explain?.calcSuccess && explain?.pre_exec.success
            //       : true,
            //     createdBy: params?.$ctx?.ga ? 'rabby' : 'dapp',
            //     source: params?.$ctx?.ga?.source || '',
            //     trigger: params?.$ctx?.ga?.trigger || '',
            //   });
          }
        }
        setSignFinishedData({
          data: sig,
          approvalId: approval.id,
        });
      } else {
        if (!isSignTextRef.current) {
          // const tx = approval.data?.params;
          const explain = explainRef.current;
          if (explain) {
            // const { nonce, from, chainId } = tx;
            // const explain = await wallet.getExplainCache({
            //   nonce: Number(nonce),
            //   address: from,
            //   chainId: Number(chainId),
            // });
            // wallet.reportStats('signedTransaction', {
            //   type: account.brandName,
            //   chainId: findChainByEnum(chain)?.serverId || '',
            //   category: KEYRING_CATEGORY_MAP[account.type],
            //   success: false,
            //   preExecSuccess: explain
            //     ? explain?.calcSuccess && explain?.pre_exec.success
            //     : true,
            //   createdBy: params?.$ctx?.ga ? 'rabby' : 'dapp',
            //   source: params?.$ctx?.ga?.source || '',
            //   trigger: params?.$ctx?.ga?.trigger || '',
            // });
          }
        }
        rejectApproval(data.errorMsg);
      }
    };
    signFinishedHandlerRef.current = signFinishedHandler;
    eventBus.addEventListener(EVENTS.SIGN_FINISHED, signFinishedHandler);

    addTrackedWcListener(
      EVENTS.WALLETCONNECT.STATUS_CHANGED,
      async ({ status, payload }) => {
        setVisible(true);
        setConnectStatus(status);
        if (
          status !== WALLETCONNECT_STATUS_MAP.FAILED &&
          status !== WALLETCONNECT_STATUS_MAP.REJECTED
        ) {
          if (!isText && !isSignTriggered) {
            const explain = explainRef.current;
            const chainInfo = findChainByEnum(chain);

            // const tx = approval.data?.params;
            if (explain || chainInfo?.isTestnet) {
              // const { nonce, from, chainId } = tx;
              // const explain = await wallet.getExplainCache({
              //   nonce: Number(nonce),
              //   address: from,
              //   chainId: Number(chainId),
              // });

              wallet.reportStats('signTransaction', {
                type: account.brandName,
                chainId: chainInfo?.serverId || '',
                category: KEYRING_CATEGORY_MAP[account.type],
                preExecSuccess: explain
                  ? explain?.calcSuccess && explain?.pre_exec.success
                  : true,
                createdBy: params?.$ctx?.ga ? 'rabby' : 'dapp',
                source: params?.$ctx?.ga?.source || '',
                trigger: params?.$ctx?.ga?.trigger || '',
                networkType: chainInfo?.isTestnet
                  ? 'Custom Network'
                  : 'Integrated Network',
              });
            }
            matomoRequestEvent({
              category: 'Transaction',
              action: 'Submit',
              label: chainInfo?.isTestnet
                ? 'Custom Network'
                : 'Integrated Network',
            });

            ga4.fireEvent(
              `Submit_${chainInfo?.isTestnet ? 'Custom' : 'Integrated'}`,
              {
                event_category: 'Transaction',
              }
            );

            isSignTriggered = true;
          }
          if (isText && !isSignTriggered) {
            wallet.reportStats('startSignText', {
              type: account.brandName,
              category: KEYRING_CATEGORY_MAP[account.type],
              method: params?.extra?.signTextMethod,
            });
            isSignTriggered = true;
          }
        }
        switch (status) {
          case WALLETCONNECT_STATUS_MAP.CONNECTED:
            break;
          case WALLETCONNECT_STATUS_MAP.FAILED:
          case WALLETCONNECT_STATUS_MAP.REJECTED:
            if (payload?.code) {
              try {
                const error = JSON.parse(payload.message);
                setConnectError({
                  code: payload.code,
                  message: error.message,
                });
              } catch (e) {
                setConnectError(payload);
              }
            } else {
              setConnectError(
                (payload?.params && payload.params[0]) || payload
              );
            }
            break;
          case WALLETCONNECT_STATUS_MAP.SUBMITTED:
            setResult(payload);
            break;
        }
      }
    );

    // gpt56 round-10 blocker 5: announce readiness ONLY after the connector
    // initialization is acknowledged. A failed/timed-out init keeps the
    // component in FAILED state (with a working re-init retry) and never
    // arms the dApp signer.
    const ready = await initWalletConnect();
    if (!ready) {
      return;
    }

    emitSignComponentAmounted(getApprovalBinding(approval));
  };

  useEffect(() => {
    init();
    setHeight('fit-content');
    return () => {
      const handler = signFinishedHandlerRef.current;
      if (handler) {
        eventBus.removeEventListener(EVENTS.SIGN_FINISHED, handler);
      }
      ackHandleRef.current?.abort();
      removeTrackedWcListeners();
    };
  }, []);

  const { stay = false } = params || {};
  useEffect(() => {
    if (signFinishedData && isClickDone) {
      closePopup();
      resolveApproval(
        signFinishedData.data,
        stay,
        false,
        signFinishedData.approvalId
      );
    }
  }, [signFinishedData, isClickDone]);

  useEffect(() => {
    if (sessionStatus === 'DISCONNECTED') {
      setVisible(false);
      message.error(t('page.signFooterBar.ledger.notConnected'));
    }
  }, [sessionStatus]);

  return (
    <div className="watchaddress">
      <div className="watchaddress-operation">
        {connectStatus === WALLETCONNECT_STATUS_MAP.PENDING &&
        qrcodeContent &&
        currentAccount ? (
          <Scan
            uri={qrcodeContent}
            onRefresh={handleRefreshQrCode}
            account={currentAccount}
          />
        ) : (
          currentAccount && (
            <Process
              chain={chain}
              result={result}
              status={connectStatus}
              error={connectError}
              onRetry={handleRetry}
              onCancel={handleCancel}
              account={currentAccount}
              onDone={() => setIsClickDone(true)}
              chainId={params?.chainId}
              nonce={params?.nonce}
              from={params?.from}
            />
          )
        )}
      </div>
    </div>
  );
};

export default WatchAddressWaiting;
