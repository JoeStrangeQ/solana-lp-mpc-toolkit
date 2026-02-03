import BN from "bn.js";
import { privy, privyAuthContext, PrivyWallet } from "../privy";
import { Address } from "../utils/solana";
import { buildTransferTokenTransaction } from "./buildTransferTokenTransaction";
import { connection } from "../convexEnv";
import { PublicKey } from "@solana/web3.js";
import { safeBigIntToNumber } from "../utils/amounts";

const MNM_FEES_WALLET_ADDRESS = "ELPSuvvkKDGSXSVoY79akTAJpnyNvS2Yzmmwb4itucxz";
const MNM_FEE_PERCENT = 5;

export async function buildTransferMnMTx({
  userWallet,
  outputMint,
  totalFeesInRawOutputToken,
}: {
  userWallet: PrivyWallet;
  outputMint: Address;
  totalFeesInRawOutputToken: BN;
}) {
  const mnmFeeRawAmount = totalFeesInRawOutputToken
    .muln(MNM_FEE_PERCENT)
    .divn(100);

  if (mnmFeeRawAmount.isNeg() || mnmFeeRawAmount.isZero()) {
    return null;
  }
  const mnmFeeRawAmountNumber = safeBigIntToNumber(
    mnmFeeRawAmount,
    "MnM Fee Raw Amount",
  );
  const { blockhash } = await connection.getLatestBlockhash();
  const mnmFeeClaimTx = await buildTransferTokenTransaction({
    mint: new PublicKey(outputMint),
    from: new PublicKey(userWallet.address),
    recipient: new PublicKey(MNM_FEES_WALLET_ADDRESS),
    rawAmount: mnmFeeRawAmountNumber,
    options: {
      cuLimit: 500_000,
      cuPriceMicroLamports: 500_000,
      recentBlockhash: blockhash,
    },
  });

  return {
    mnmFeeClaimTx,
    mnmFeeRawAmount: mnmFeeRawAmountNumber,
    totalFeesAfterMnMCut: safeBigIntToNumber(
      totalFeesInRawOutputToken.sub(mnmFeeRawAmount),
      "total fees after mnm cut",
    ),
  };
}
export async function transferMnMFees({
  userWallet,
  outputMint,
  totalFeesInRawOutputToken,
}: {
  userWallet: PrivyWallet;
  outputMint: Address;
  totalFeesInRawOutputToken: BN;
}) {
  const mnmFeeRawAmount = totalFeesInRawOutputToken
    .muln(MNM_FEE_PERCENT)
    .divn(100);

  if (mnmFeeRawAmount.isNeg() || mnmFeeRawAmount.isZero()) {
    return { mnmFeeTransferTxId: null, mnmFeeRawAmount: 0 };
  }
  const mnmFeeRawAmountNumber = safeBigIntToNumber(
    mnmFeeRawAmount,
    "MnM Fee Raw Amount",
  );
  const { blockhash } = await connection.getLatestBlockhash();
  const mnmFeeClaimTx = await buildTransferTokenTransaction({
    mint: new PublicKey(outputMint),
    from: new PublicKey(userWallet.address),
    recipient: new PublicKey(MNM_FEES_WALLET_ADDRESS),
    rawAmount: mnmFeeRawAmountNumber,
    options: {
      cuLimit: 500_000,
      cuPriceMicroLamports: 500_000,
      recentBlockhash: blockhash,
    },
  });

  const { signed_transaction } = await privy
    .wallets()
    .solana()
    .signTransaction(userWallet.id ?? "", {
      address: userWallet.address,
      authorization_context: privyAuthContext,
      transaction: mnmFeeClaimTx.serialize(),
    });

  const txId = await connection.sendRawTransaction(
    Buffer.from(signed_transaction, "base64"),
    { skipPreflight: true },
  );

  return {
    mnmFeeTransferTxId: txId,
    mnmFeeRawAmount: mnmFeeRawAmountNumber,
    totalFeesAfterMnMCut: safeBigIntToNumber(
      totalFeesInRawOutputToken.sub(mnmFeeRawAmount),
      "total fees after mnm cut",
    ),
  };
}
