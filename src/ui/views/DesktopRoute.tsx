import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { PrivateRoute, PrivateRouteGuard } from 'ui/component';

import { PortalHost } from '../component/PortalHost';
import { CommonPopup } from './CommonPopup';
import { DesktopProfile } from './DesktopProfile';
import {
  GlobalSignerPortal,
  GlobalTypedDataSignerPortal,
} from '../component/MiniSignV2/components';

import { AddAddressModal } from './DesktopProfile/components/AddAddressModal';
import { useRabbyDispatch } from '../store';
import { useEventBusListener } from '../hooks/useEventBusListener';
import { EVENTS } from '@/constant';
import { useMemoizedFn } from 'ahooks';
import { useContactBookStore } from '@/ui/state/contactBook';
import { DesktopManageApprovals } from './DesktopManageApprovals';

const Main = () => {
  const location = useLocation();
  const isProfileRoute = location.pathname.startsWith('/desktop/profile');

  const hasMountedProfileRef = useRef(false);

  if (isProfileRoute) {
    hasMountedProfileRef.current = true;
  }

  const dispatch = useRabbyDispatch();

  const fetchAllAccounts = useMemoizedFn(() =>
    dispatch.addressManagement.getHilightedAddressesAsync().then(() => {
      dispatch.accountToDisplay.getAllAccountsToDisplay();
    })
  );

  useEventBusListener(EVENTS.PERSIST_KEYRING, fetchAllAccounts);
  useEventBusListener(EVENTS.RELOAD_ACCOUNT_LIST, async () => {
    await dispatch.preference.getPreference('addressSortStore');
    fetchAllAccounts();
  });

  useEffect(() => {
    return useContactBookStore.subscribe(fetchAllAccounts);
  }, [fetchAllAccounts]);

  return (
    <>
      <PrivateRoute exact path="/desktop/manage-approvals">
        <DesktopManageApprovals />
      </PrivateRoute>
      {hasMountedProfileRef.current ? (
        <PrivateRouteGuard>
          <DesktopProfile
            isActive={isProfileRoute}
            style={isProfileRoute ? undefined : { display: 'none' }}
          />
        </PrivateRouteGuard>
      ) : null}

      {location.pathname !== '/unlock' ? (
        <>
          <CommonPopup />
          <PortalHost />
          <GlobalSignerPortal isDesktop />
          <GlobalTypedDataSignerPortal isDesktop />
          <AddAddressModal />
        </>
      ) : null}
    </>
  );
};

export default Main;
