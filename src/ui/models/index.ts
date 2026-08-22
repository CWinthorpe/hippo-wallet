import { Models, RematchDispatch, RematchRootState } from '@rematch/core';

import { app } from './app';
import { account } from './account';
import { preference } from './preference';
import { accountToDisplay } from './accountToDisplay';
import { addressManagement } from './addressManagement';
import { chains } from './chains';

export interface RootModel extends Models<RootModel> {
  app: typeof app;
  account: typeof account;
  preference: typeof preference;
  accountToDisplay: typeof accountToDisplay;
  addressManagement: typeof addressManagement;
  chains: typeof chains;
}

export const models: RootModel = {
  app,
  account,
  preference,
  accountToDisplay,
  addressManagement,
  chains,
};

export type RabbyDispatch = RematchDispatch<RootModel>;
export type RabbyRootState = RematchRootState<RootModel>;
