import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { Button, message, Spin, Switch } from 'antd';
import { useHistory } from 'react-router-dom';
import { PageHeader } from '@/ui/component';
import { useWallet } from '@/ui/utils';
import {
  EMPTY_REMOTE_DATA_CAPABILITIES,
  RemoteDataCapability,
  RemoteDataCapabilityState,
  RemoteDataPolicy,
} from '@/types/remoteDataPolicy';
import { initializeBizStores } from '@/ui/state/initializeBizStores';
import { initializeExchangeStore } from '@/ui/state/exchange';
import { initializeChainsStore } from '@/ui/state/chains';
import browser from 'webextension-polyfill';

const CAPABILITY_COPY: Array<{
  id: RemoteDataCapability;
  title: string;
  description: string;
  disclosure: string;
}> = [
  {
    id: 'portfolio',
    title: 'Portfolio and DeFi data',
    description: 'Full token discovery, prices, balances and DeFi positions.',
    disclosure: 'Sends wallet addresses, selected chains and asset queries.',
  },
  {
    id: 'history',
    title: 'Transaction history',
    description: 'Cross-chain and pre-installation activity history.',
    disclosure: 'Sends wallet addresses, chains and history filters.',
  },
  {
    id: 'nft',
    title: 'NFT discovery and metadata',
    description: 'Discovers owned NFTs and loads collection metadata.',
    disclosure: 'Sends wallet addresses, chains and NFT identifiers.',
  },
  {
    id: 'signing',
    title: 'Enhanced signing analysis',
    description: 'Human-readable transaction, message and typed-data analysis.',
    disclosure:
      'Sends the wallet address, dapp origin and unsigned signing payload.',
  },
  {
    id: 'approvals',
    title: 'Approval and allowance indexing',
    description: 'Discovers historical token, NFT and Permit2 approvals.',
    disclosure: 'Sends wallet addresses and requested chains.',
  },
  {
    id: 'security',
    title: 'Site, address and contract intelligence',
    description: 'Remote phishing, reputation and contract-label checks.',
    disclosure: 'Sends origins, addresses, chains and function selectors.',
  },
  {
    id: 'dapps',
    title: 'Dapp discovery and metadata',
    description: 'Searches dapps and loads their metadata and icons.',
    disclosure: 'Sends search terms, chains and requested dapp identifiers.',
  },
  {
    id: 'feedback',
    title: 'Support and feedback uploads',
    description: 'Allows deliberate feedback submission to the backend.',
    disclosure: 'Sends only the feedback payload shown before submission.',
  },
];

const cloneEmptyCapabilities = (): RemoteDataCapabilityState => ({
  ...EMPTY_REMOTE_DATA_CAPABILITIES,
});

const RemoteDataPolicyEditor = ({
  initialPolicy,
  setup,
  onSaved,
}: {
  initialPolicy?: RemoteDataPolicy;
  setup?: boolean;
  onSaved?: (policy: RemoteDataPolicy) => void;
}) => {
  const wallet = useWallet();
  const [capabilities, setCapabilities] = useState<RemoteDataCapabilityState>(
    () => initialPolicy?.capabilities || cloneEmptyCapabilities()
  );
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const enabledCount = useMemo(
    () => Object.values(capabilities).filter(Boolean).length,
    [capabilities]
  );

  useEffect(() => {
    if (initialPolicy) {
      setCapabilities({ ...initialPolicy.capabilities });
    }
  }, [initialPolicy]);

  const save = async () => {
    setSaving(true);
    try {
      const policy = await wallet.setRemoteDataPolicy(capabilities);
      onSaved?.(policy);
      if (!setup) message.success('Privacy settings saved');
    } catch (error: any) {
      message.error(error?.message || 'Unable to save privacy settings');
    } finally {
      setSaving(false);
    }
  };

  const blockAll = () => setCapabilities(cloneEmptyCapabilities());

  const clearCaches = async () => {
    setClearing(true);
    try {
      const policy = await wallet.clearRemoteDataCaches();
      onSaved?.(policy);
      message.success('Provider caches and contact log cleared');
    } catch (error: any) {
      message.error(error?.message || 'Unable to clear provider caches');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-r-neutral-bg-2 px-20 pb-20">
      {setup ? (
        <div className="pt-24 text-center">
          <div className="text-[22px] font-medium text-r-neutral-title-1">
            Choose your privacy level
          </div>
          <div className="mx-auto mt-8 max-w-[560px] text-[13px] leading-[19px] text-r-neutral-foot">
            Hippo blocks every Rabby/DeBank connection until you explicitly
            enable a section. You can change these choices later in Settings.
          </div>
        </div>
      ) : null}

      <div className="mx-auto mt-20 w-full max-w-[640px] space-y-12">
        <div className="rounded-[12px] bg-r-neutral-card-1 p-16 shadow-sm">
          <div className="flex items-center justify-between gap-16">
            <div>
              <div className="text-[15px] font-medium text-r-neutral-title-1">
                Rabby/DeBank connections
              </div>
              <div className="mt-4 text-[12px] text-r-neutral-foot">
                {enabledCount === 0
                  ? 'All upstream connections blocked'
                  : `${enabledCount} section${
                      enabledCount === 1 ? '' : 's'
                    } enabled`}
              </div>
            </div>
            <Button onClick={blockAll} disabled={enabledCount === 0}>
              Block all
            </Button>
          </div>
        </div>

        {CAPABILITY_COPY.map((item) => (
          <div
            key={item.id}
            className="rounded-[12px] bg-r-neutral-card-1 p-16 shadow-sm"
          >
            <div className="flex items-start justify-between gap-16">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-r-neutral-title-1">
                  {item.title}
                </div>
                <div className="mt-4 text-[12px] leading-[18px] text-r-neutral-body">
                  {item.description}
                </div>
                <div className="mt-6 text-[11px] leading-[16px] text-r-neutral-foot">
                  {item.disclosure}
                </div>
                {initialPolicy?.lastContacts?.[item.id] ? (
                  <div className="mt-6 text-[11px] leading-[16px] text-r-neutral-foot">
                    Last contact:{' '}
                    {initialPolicy.lastContacts[item.id]?.hostname} at{' '}
                    {new Date(
                      initialPolicy.lastContacts[item.id]!.at
                    ).toLocaleString()}
                  </div>
                ) : (
                  <div className="mt-6 text-[11px] leading-[16px] text-r-neutral-foot">
                    No recorded contact
                  </div>
                )}
              </div>
              <Switch
                checked={capabilities[item.id]}
                onChange={(checked) =>
                  setCapabilities((current: RemoteDataCapabilityState) => ({
                    ...current,
                    [item.id]: checked,
                  }))
                }
              />
            </div>
          </div>
        ))}

        <div className="rounded-[12px] border border-r-neutral-line bg-r-neutral-card-1 p-12 text-[11px] leading-[17px] text-r-neutral-foot">
          RPC providers, CoW Protocol and MEV Blocker are separate data sources
          and are not controlled by these switches. Removed features cannot be
          restored here.
        </div>

        {!setup ? (
          <Button block loading={clearing} onClick={clearCaches}>
            Clear provider caches and contact log
          </Button>
        ) : null}

        <Button
          type="primary"
          size="large"
          block
          loading={saving}
          onClick={save}
          className="h-[48px]"
        >
          {setup
            ? enabledCount === 0
              ? 'Continue with all connections blocked'
              : 'Save choices and continue'
            : 'Save privacy settings'}
        </Button>
      </div>
    </div>
  );
};

export const RemoteDataPolicyGate = ({ children }: { children: ReactNode }) => {
  const wallet = useWallet();
  const [policy, setPolicy] = useState<RemoteDataPolicy>();

  useEffect(() => {
    let active = true;
    wallet
      .getRemoteDataPolicy()
      .then((value: RemoteDataPolicy) => active && setPolicy(value))
      .catch(() => active && setPolicy(undefined));
    return () => {
      active = false;
    };
  }, [wallet]);

  useEffect(() => {
    const onStorageChanged = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string
    ) => {
      const next = changes.hippoRemoteDataPolicy?.newValue;
      if (areaName === 'local' && next) {
        setPolicy(next as RemoteDataPolicy);
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  useEffect(() => {
    if (!policy?.configured) return;
    void initializeBizStores();
    void initializeExchangeStore();
    void initializeChainsStore();
  }, [policy?.configured]);

  if (!policy) {
    return (
      <div className="flex h-screen items-center justify-center bg-r-neutral-bg-2">
        <Spin />
      </div>
    );
  }

  if (!policy.configured) {
    return (
      <RemoteDataPolicyEditor
        setup
        initialPolicy={policy}
        onSaved={setPolicy}
      />
    );
  }

  return <>{children}</>;
};

export const RemoteDataPolicySettings = () => {
  const wallet = useWallet();
  const history = useHistory();
  const [policy, setPolicy] = useState<RemoteDataPolicy>();

  useEffect(() => {
    wallet.getRemoteDataPolicy().then(setPolicy);
  }, [wallet]);

  return (
    <div className="flex h-full flex-col bg-r-neutral-bg-2">
      <PageHeader forceShowBack onBack={() => history.goBack()}>
        Privacy & Data Sources
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {policy ? (
          <RemoteDataPolicyEditor initialPolicy={policy} onSaved={setPolicy} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spin />
          </div>
        )}
      </div>
    </div>
  );
};
