import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Input, Button, InputRef } from 'antd';
import styled from 'styled-components';
import { useDebounce } from 'react-use';
import { useWallet } from 'ui/utils';
import { CHAINS_ENUM } from 'consts';
import { Popup, PageHeader } from 'ui/component';
import { isValidateUrl } from 'ui/utils/url';
import { RPCItem } from '@/background/service/rpc';
import { findChainByEnum } from '@/utils/chain';
import { useTranslation } from 'react-i18next';

const { TextArea } = Input;

const ErrorMsg = styled.div`
  color: #ec5151;
  font-weight: 400;
  font-size: 12px;
  line-height: 16px;
  margin-top: 8px;
`;

const Footer = styled.div`
  height: 84px;
  border-top: 0.5px solid var(--r-neutral-line, rgba(255, 255, 255, 0.1));
  background: var(--r-neutral-card-1, rgba(255, 255, 255, 0.06));
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  width: 100vw;
  position: absolute;
  left: -20px;
  bottom: 0;
`;

const EditRPCWrapped = styled.div`
  position: relative;
  height: 100%;
  overflow: auto;
  padding-bottom: 84px;

  .rpc-input.rpc-input {
    width: 100%;
    margin-left: auto;
    margin-right: auto;
    background: transparent !important;
    border: 1px solid var(--r-neutral-line, #d3d8e0) !important;
    border-radius: 6px;
    color: var(--r-neutral-title1, #192945) !important;
    font-size: 15px;

    &:focus {
      border-color: var(--r-blue-default, #7084ff) !important;
    }
    &.has-error {
      border-color: #ec5151 !important;
    }
    &::placeholder {
      color: var(--r-neutral-foot, #6a7587) !important;
    }
  }

  input.rpc-input {
    height: 48px;
  }
`;

const parseFallbackUrls = (value: string) =>
  value
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);

export type RPCFormValue = Pick<
  RPCItem,
  'url' | 'fallbackUrls' | 'broadcastUrl'
>;

const EditRPCModal = ({
  chain,
  rpcInfo,
  visible,
  onCancel,
  onConfirm,
}: {
  chain: CHAINS_ENUM;
  rpcInfo: { id: CHAINS_ENUM; rpc: RPCItem } | null;
  visible: boolean;
  onCancel(): void;
  onConfirm(value: RPCFormValue): void;
}) => {
  const wallet = useWallet();
  const chainItem = useMemo(() => findChainByEnum(chain), [chain]);
  const [rpcUrl, setRpcUrl] = useState('');
  const [fallbackText, setFallbackText] = useState('');
  const [broadcastUrl, setBroadcastUrl] = useState('');
  const [rpcErrorMsg, setRpcErrorMsg] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validatedConfiguration, setValidatedConfiguration] = useState('');
  const { t } = useTranslation();

  const inputRef = useRef<InputRef>(null);
  const validationSequence = useRef(0);
  const fallbackUrls = useMemo(() => parseFallbackUrls(fallbackText), [
    fallbackText,
  ]);
  const configuredUrls = useMemo(
    () => [rpcUrl, ...fallbackUrls, broadcastUrl].filter(Boolean),
    [rpcUrl, fallbackUrls, broadcastUrl]
  );
  const configurationKey = useMemo(
    () => JSON.stringify([chainItem?.id, ...configuredUrls]),
    [chainItem?.id, configuredUrls]
  );
  const urlsAreWellFormed = configuredUrls.every(isValidateUrl);
  const canSubmit = Boolean(
    rpcUrl &&
      urlsAreWellFormed &&
      !rpcErrorMsg &&
      !isValidating &&
      validatedConfiguration === configurationKey
  );

  const rpcValidation = async () => {
    const validationId = ++validationSequence.current;
    if (!chainItem || !rpcUrl || !urlsAreWellFormed) {
      if (validationId === validationSequence.current) {
        setValidatedConfiguration('');
        setRpcErrorMsg(
          rpcUrl && !urlsAreWellFormed
            ? t('page.customRpc.EditRPCModal.invalidRPCUrl')
            : ''
        );
      }
      return;
    }

    try {
      setIsValidating(true);
      const validity = await Promise.all(
        configuredUrls.map((url) => wallet.validateRPC(url, chainItem.id))
      );
      if (validationId !== validationSequence.current) {
        return;
      }
      if (validity.some((valid) => !valid)) {
        setValidatedConfiguration('');
        setRpcErrorMsg(t('page.customRpc.EditRPCModal.invalidChainId'));
      } else {
        setRpcErrorMsg('');
        setValidatedConfiguration(configurationKey);
      }
    } catch (e) {
      if (validationId === validationSequence.current) {
        setValidatedConfiguration('');
        setRpcErrorMsg(t('page.customRpc.EditRPCModal.rpcAuthFailed'));
      }
    } finally {
      if (validationId === validationSequence.current) {
        setIsValidating(false);
      }
    }
  };

  useEffect(() => {
    validationSequence.current += 1;
    setValidatedConfiguration('');
    setIsValidating(false);
  }, [configurationKey]);

  useDebounce(rpcValidation, 250, [
    rpcUrl,
    fallbackText,
    broadcastUrl,
    chainItem?.id,
  ]);

  useEffect(() => {
    setRpcUrl(rpcInfo?.rpc.url || '');
    setFallbackText((rpcInfo?.rpc.fallbackUrls || []).join('\n'));
    setBroadcastUrl(rpcInfo?.rpc.broadcastUrl || '');
  }, [rpcInfo]);

  useEffect(() => {
    if (!visible) {
      setRpcUrl('');
      setFallbackText('');
      setBroadcastUrl('');
      setRpcErrorMsg('');
    }
    setTimeout(() => {
      inputRef.current?.input?.focus();
    });
  }, [visible]);

  return (
    <Popup
      height={600}
      visible={visible}
      onCancel={onCancel}
      bodyStyle={{ paddingBottom: 0 }}
      style={{ zIndex: 1001 }}
      isSupportDarkMode
    >
      <EditRPCWrapped>
        <PageHeader forceShowBack onBack={onCancel} className="pt-0">
          {t('page.customRpc.EditRPCModal.title')}
        </PageHeader>
        <div className="text-center">
          <img
            className="w-[48px] h-[48px] mx-auto mb-8"
            src={chainItem?.logo || ''}
          />
          <div className="mb-16 text-20 text-r-neutral-title-1 leading-none">
            {chainItem?.name}
          </div>
        </div>

        <div className="mb-8 text-13 text-r-neutral-title-1 text-left">
          Primary read / estimate RPC
        </div>
        <Input
          ref={inputRef}
          className={clsx('rpc-input', { 'has-error': rpcErrorMsg })}
          value={rpcUrl}
          placeholder="https://eth.drpc.org"
          onChange={(event) => setRpcUrl(event.target.value.trim())}
        />

        <div className="mt-16 mb-8 text-13 text-r-neutral-title-1 text-left">
          Ordered read fallbacks (optional, one URL per line)
        </div>
        <TextArea
          className={clsx('rpc-input', { 'has-error': rpcErrorMsg })}
          value={fallbackText}
          autoSize={{ minRows: 2, maxRows: 3 }}
          placeholder="https://rpc.mevblocker.io"
          onChange={(event) => setFallbackText(event.target.value)}
        />

        <div className="mt-16 mb-8 text-13 text-r-neutral-title-1 text-left">
          Signed transaction broadcast RPC (optional)
        </div>
        <Input
          className={clsx('rpc-input', { 'has-error': rpcErrorMsg })}
          value={broadcastUrl}
          placeholder="Defaults to the primary RPC"
          onChange={(event) => setBroadcastUrl(event.target.value.trim())}
        />

        <div className="mt-8 text-12 leading-16 text-r-neutral-foot">
          Fallbacks apply only to stateless reads and estimates. Signed raw
          transactions go to exactly one broadcast endpoint and are never
          retried elsewhere. Use credential-free URLs in this private build.
        </div>
        {rpcErrorMsg && <ErrorMsg>{rpcErrorMsg}</ErrorMsg>}

        <Footer>
          <Button
            type="primary"
            size="large"
            className="rabby-btn-ghost w-[172px]"
            ghost
            onClick={onCancel}
          >
            {t('global.Cancel')}
          </Button>
          <Button
            type="primary"
            loading={isValidating}
            size="large"
            className="w-[172px]"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                url: rpcUrl,
                fallbackUrls,
                broadcastUrl: broadcastUrl || undefined,
              })
            }
          >
            {isValidating ? t('global.Loading') : t('global.Save')}
          </Button>
        </Footer>
      </EditRPCWrapped>
    </Popup>
  );
};

export default EditRPCModal;
