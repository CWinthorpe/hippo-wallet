import { CHAINS, SIGN_PERMISSION_TYPES } from './../../constant/index';
import LRU from 'lru-cache';
import { createPersistStore } from 'background/utils';
import { CHAINS_ENUM, INTERNAL_REQUEST_ORIGIN } from 'consts';
import { max } from 'lodash';
import { findChain, findChainByEnum } from '@/utils/chain';
import { BasicDappInfo } from './openapi';
import { Account } from './preference';

export interface ConnectedSite {
  origin: string;
  icon: string;
  name: string;
  chain: CHAINS_ENUM;
  e?: number;
  isSigned: boolean;
  isTop: boolean;
  order?: number;
  isConnected: boolean;
  /**
   * @deprecated
   */
  preferMetamask?: boolean;
  isFavorite?: boolean;
  info?: BasicDappInfo;
  /**
   * eip6963 rdns
   */
  rdns?: string;
  isMetamaskMode?: boolean;

  account?: Account | null;
}

export type PermissionStore = {
  dumpCache: ReadonlyArray<LRU.Entry<string, ConnectedSite>>;
};

type AuthorityBoundary = (
  previousSites: ConnectedSite[],
  nextSites: ConnectedSite[]
) => void;

class PermissionService {
  store: PermissionStore = {
    dumpCache: [],
  };
  lruCache: LRU<string, ConnectedSite> | undefined;
  private authorityBoundary?: AuthorityBoundary;

  /**
   * Installed by sessionBoundary without importing notificationService here;
   * permissionService is imported by notificationService during startup.
   * Every authority-bearing mutation calls this synchronously before writing.
   */
  setAuthorityBoundary = (boundary: AuthorityBoundary) => {
    this.authorityBoundary = boundary;
  };

  private beforeAuthorityMutation = (
    previous: ConnectedSite | undefined,
    next: ConnectedSite | undefined
  ) => {
    if (!this.authorityBoundary) return;
    const origin = previous?.origin || next?.origin;
    if (!origin) return;
    this.authorityBoundary(previous ? [previous] : [], next ? [next] : []);
  };

  init = async () => {
    const storage = await createPersistStore<PermissionStore>({
      name: 'permission',
    });
    this.store = storage || this.store;

    this.lruCache = new LRU();

    let filtered = false;
    const cache: ReadonlyArray<LRU.Entry<string, ConnectedSite>> = (
      this.store.dumpCache || []
    )
      .filter((item) => {
        const found = item?.v?.chain && findChainByEnum(item.v.chain);
        if (!filtered && !found) filtered = true;
        return found;
      })
      .map((item) => ({
        k: item.k,
        v: item.v,
        e: 0,
      }));
    this.lruCache.load(cache);

    if (filtered) this.sync();
  };

  sync = () => {
    if (!this.lruCache) return;
    this.store.dumpCache = this.lruCache.dump();
  };

  getWithoutUpdate = (key: string) => {
    if (!this.lruCache) return;

    return this.lruCache.peek(key);
  };

  private _getSite = (origin: string) => {
    const siteItem = this.lruCache?.get(origin);

    if (!siteItem) return siteItem;

    const chainItem = findChain({ enum: siteItem.chain });

    return chainItem
      ? siteItem
      : {
          ...siteItem,
          chain: CHAINS_ENUM.ETH,
          isConnected: false,
        };
  };

  getSite = (origin: string | number) => {
    const _origin = origin.toString();
    return this._getSite(_origin);
  };

  setSite = (site: ConnectedSite) => {
    if (!this.lruCache) return;
    this.beforeAuthorityMutation(this._getSite(site.origin), site);
    this.lruCache.set(site.origin, site);
    this.sync();
  };

  /**
   * @deprecated
   *
   * @param origin
   * @param name
   * @param icon
   * @param defaultChain
   * @param isSigned
   * @returns
   */
  addConnectedSite = (
    origin: string,
    name: string,
    icon: string,
    defaultChain: CHAINS_ENUM,
    isSigned = false
  ) => {
    if (!this.lruCache) return;

    this.setSite({
      origin,
      name,
      icon,
      chain: defaultChain,
      isSigned,
      isTop: false,
      isConnected: true,
    });
  };

  addConnectedSiteV2 = ({
    origin,
    name,
    icon,
    defaultChain,
    defaultAccount,
    isSigned = false,
  }: {
    origin: string;
    name: string;
    icon: string;
    defaultChain: CHAINS_ENUM;
    defaultAccount?: Account;
    isSigned?: boolean;
  }) => {
    if (!this.lruCache) return;

    const site = this._getSite(origin);

    this.setSite({
      ...site,
      origin,
      name,
      icon,
      isSigned,
      isTop: false,
      chain: defaultChain,
      account: defaultAccount,
      isConnected: true,
    });
  };

  touchConnectedSite = (origin) => {
    if (!this.lruCache) return;
    if (origin === INTERNAL_REQUEST_ORIGIN) return;
    this.lruCache.get(origin);
    this.sync();
  };

  updateConnectSite = (
    origin: string,
    value: Partial<ConnectedSite>,
    partialUpdate?: boolean
  ) => {
    if (!this.lruCache || !this.lruCache.has(origin)) return;
    if (origin === INTERNAL_REQUEST_ORIGIN) return;

    if (value.chain && !findChain({ enum: value.chain })) {
      return;
    }

    const previous = this._getSite(origin);
    const next = (partialUpdate
      ? { ...previous, ...value }
      : value) as ConnectedSite;
    this.beforeAuthorityMutation(previous, next);
    this.lruCache.set(origin, next);

    this.sync();
  };

  hasPermission = (origin) => {
    if (!this.lruCache) return;
    if (origin === INTERNAL_REQUEST_ORIGIN) return true;

    const site = this._getSite(origin);
    return site && site.isConnected;
  };

  setRecentConnectedSites = (sites: ConnectedSite[]) => {
    const nextSites = sites.concat(
      (this.lruCache?.values() || []).filter((item) => !item.isConnected)
    );
    if (this.authorityBoundary) {
      this.authorityBoundary(this.getSites(), nextSites);
    }
    this.lruCache?.load(
      nextSites.map((item) => ({
        e: 0,
        k: item.origin,
        v: item,
      }))
    );
    this.sync();
  };

  getRecentConnectedSites = () => {
    const sites = (this.lruCache?.values() || []).filter(
      (item) => item.isConnected
    );
    const pinnedSites = sites
      .filter((item) => item?.isTop)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const recentSites = sites.filter((item) => !item.isTop);
    return [...pinnedSites, ...recentSites];
  };

  getConnectedSites = () => {
    return (this.lruCache?.values() || []).filter((item) => item.isConnected);
  };

  getSites = () => {
    return this.lruCache?.values() || [];
  };

  getPreferMetamaskSites = () => {
    return (this.lruCache?.values() || []).filter(
      (item) => item.preferMetamask
    );
  };

  getMetamaskModeSites = () => {
    return (this.lruCache?.values() || []).filter(
      (item) => item.isMetamaskMode
    );
  };

  getConnectedSite = (key: string) => {
    const site = this._getSite(key);
    if (site && site.isConnected) {
      return site;
    }
  };

  topConnectedSite = (origin: string, order?: number) => {
    const site = this.getConnectedSite(origin);
    if (!site || !this.lruCache) return;
    order =
      order ??
      (max(this.getRecentConnectedSites().map((item) => item.order)) || 0) + 1;
    this.updateConnectSite(origin, {
      ...site,
      order,
      isTop: true,
    });
  };

  favoriteWebsite = (origin: string, order?: number) => {
    const site = this.getConnectedSite(origin);
    if (!site || !this.lruCache) return;
    order =
      order ??
      (max(this.getRecentConnectedSites().map((item) => item.order)) || 0) + 1;
    this.updateConnectSite(origin, {
      ...site,
      order,
      isFavorite: true,
    });
  };

  unFavoriteWebsite = (origin: string) => {
    const site = this.getConnectedSite(origin);
    if (!site || !this.lruCache) return;
    this.updateConnectSite(origin, {
      ...site,
      isFavorite: false,
    });
  };

  unpinConnectedSite = (origin: string) => {
    const site = this.getConnectedSite(origin);
    if (!site || !this.lruCache) return;
    this.updateConnectSite(origin, {
      ...site,
      isTop: false,
    });
  };

  removeConnectedSite = (origin: string) => {
    if (!this.lruCache) return;
    const site = this.getSite(origin);
    if (!site) {
      return;
    }
    this.setSite({
      ...site,
      rdns: undefined,
      isConnected: false,
    });
    this.sync();
  };

  getSitesByDefaultChain = (chain: CHAINS_ENUM) => {
    if (!this.lruCache) return [];
    return this.lruCache.values().filter((item) => item.chain === chain);
  };

  isInternalOrigin = (origin: string) => {
    return origin === INTERNAL_REQUEST_ORIGIN;
  };
}

export default new PermissionService();
