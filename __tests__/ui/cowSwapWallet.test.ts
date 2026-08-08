import {
  getCowSwapTransactionReceipt,
  sendCowSwapTransaction,
  signCowSwapTypedData,
} from '@/ui/views/Swap/cowSwapWallet';

const account = {
  address: '0x0000000000000000000000000000000000000001',
  type: 'Simple Key Pair',
  brandName: 'Hippo',
} as any;

describe('CoW wallet request routing', () => {
  test('uses the wallet approval flow for transactions with an explicit chain ID', async () => {
    const wallet = {
      sendRequest: jest.fn().mockResolvedValue(`0x${'11'.repeat(32)}`),
      requestETHRpc: jest.fn(),
    } as any;
    const transaction = {
      from: account.address,
      to: '0x0000000000000000000000000000000000000002',
      value: '0x0',
      data: '0x1234',
    };

    await sendCowSwapTransaction(wallet, account, 42161, transaction);

    expect(wallet.sendRequest).toHaveBeenCalledWith(
      {
        method: 'eth_sendTransaction',
        params: [{ ...transaction, chainId: 42161 }],
      },
      { account }
    );
    expect(wallet.requestETHRpc).not.toHaveBeenCalled();
  });

  test('uses the wallet typed-data signer instead of forwarding to RPC', async () => {
    const wallet = {
      sendRequest: jest.fn().mockResolvedValue(`0x${'22'.repeat(65)}`),
      requestETHRpc: jest.fn(),
    } as any;
    const payload = {
      domain: { chainId: 1 },
      primaryType: 'Order',
      types: { Order: [] },
      message: { sellAmount: '1' },
    };

    await signCowSwapTypedData(wallet, account, 1, payload);

    expect(wallet.sendRequest).toHaveBeenCalledWith(
      {
        method: 'eth_signTypedData_v4',
        params: [account.address, JSON.stringify(payload)],
        $ctx: { chainId: 1 },
      },
      { account }
    );
    expect(wallet.requestETHRpc).not.toHaveBeenCalled();
  });

  test('rejects typed data for a different chain before opening approval', async () => {
    const wallet = {
      sendRequest: jest.fn(),
      requestETHRpc: jest.fn(),
    } as any;

    expect(() =>
      signCowSwapTypedData(wallet, account, 42161, {
        domain: { chainId: 1 },
      })
    ).toThrow('selected chain');
    expect(wallet.sendRequest).not.toHaveBeenCalled();
  });

  test('keeps receipt reads on raw RPC using the chain server ID', async () => {
    const wallet = {
      sendRequest: jest.fn(),
      requestETHRpc: jest.fn().mockResolvedValue(null),
    } as any;
    const hash = `0x${'33'.repeat(32)}`;

    await getCowSwapTransactionReceipt(wallet, account, 'arb', hash);

    expect(wallet.requestETHRpc).toHaveBeenCalledWith(
      { method: 'eth_getTransactionReceipt', params: [hash] },
      'arb',
      account
    );
    expect(wallet.sendRequest).not.toHaveBeenCalled();
  });
});
