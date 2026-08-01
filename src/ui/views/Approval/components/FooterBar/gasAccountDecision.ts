export const shouldAutoSwitchToGasAccountFromGasless = (_params: {
  showGasLess: boolean;
  isGasNotEnough: boolean;
  canUseGasLess: boolean;
  canGotoUseGasAccount: boolean;
}) => false;

export const shouldShowGasLessNotEnough = (_params: {
  showGasLess: boolean;
  isGasNotEnough: boolean;
  payGasByGasAccount: boolean;
  canUseGasLess: boolean;
}) => false;

export const getGasAccountDecision = (_params: {
  gasAccountCost?: unknown;
  noCustomRPC: boolean;
  isWalletConnect: boolean;
  accountType: string;
  authTimeFormChanged?: boolean;
}) => ({
  customRPCUnsupported: true,
  walletConnectUnsupported: false,
  chainUnsupported: false,
  insufficientBalance: false,
  blockingError: null,
  canUseGasAccount: false,
  canGotoUseGasAccount: false,
  canDepositUseGasAccount: false,
  canEnterNewTopUpFlow: false,
  shouldKeepLegacyTipBehavior: false,
  authTimeFormChanged: false,
  canResumeAfterTopUp: false,
});
