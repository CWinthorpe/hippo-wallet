import { Models, RematchDispatch, RematchRootState } from '@rematch/core';

import { app } from './app';
import { appVersion } from './appVersion';
import { account } from './account';
import { permission } from './permission';
import { preference } from './preference';
import { openapi } from './openapi';
import { contactBook } from './contactBook';
import { accountToDisplay } from './accountToDisplay';
import { createMnemonics } from './createMnemonics';
import { importMnemonics } from './importMnemonics';
import { addressManagement } from './addressManagement';
import { transactions } from './transactions';
import { chains } from './chains';
import { customRPC } from './customRPC';
import { securityEngine } from './securityEngine';
import { sign } from './sign';
import { rateGuidance } from './rateGuidance';
import { exchange } from './exchange';

export interface RootModel extends Models<RootModel> {
  app: typeof app;
  appVersion: typeof appVersion;
  account: typeof account;
  permission: typeof permission;
  preference: typeof preference;
  openapi: typeof openapi;
  contactBook: typeof contactBook;
  accountToDisplay: typeof accountToDisplay;
  createMnemonics: typeof createMnemonics;
  importMnemonics: typeof importMnemonics;
  addressManagement: typeof addressManagement;
  transactions: typeof transactions;
  chains: typeof chains;
  customRPC: typeof customRPC;
  securityEngine: typeof securityEngine;
  sign: typeof sign;
  rateGuidance: typeof rateGuidance;
  exchange: typeof exchange;
}

export const models: RootModel = {
  app,
  appVersion,
  account,
  permission,
  preference,
  openapi,
  contactBook,
  accountToDisplay,
  createMnemonics,
  importMnemonics,
  addressManagement,
  transactions,
  chains,
  customRPC,
  securityEngine,
  sign,
  rateGuidance,
  exchange,
};

export type RabbyDispatch = RematchDispatch<RootModel>;
export type RabbyRootState = RematchRootState<RootModel>;
