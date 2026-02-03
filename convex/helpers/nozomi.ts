import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NOZOMI_API_KEY } from "../convexEnv";
import { privy, privyAuthContext, PrivyWallet } from "../privy";
import bs58 from "bs58";
import { fastTransactionConfirm } from "../utils/solana";

const NOZOMI_TIP_ADDRESSES = [
  "TEMPaMeCRFAS9EKF53Jd6KpHxgL47uWLcpFArU1Fanq",
  "noz3jAjPiHuBPqiSPkkugaJDkJscPuRhYnSpbi8UvC4",
  "noz3str9KXfpKknefHji8L1mPgimezaiUyCHYMDv1GE",
  "noz6uoYCDijhu1V7cutCpwxNiSovEwLdRHPwmgCGDNo",
  "noz9EPNcT7WH6Sou3sr3GGjHQYVkN3DNirpbvDkv9YJ",
  "nozc5yT15LazbLTFVZzoNZCwjh3yUtW86LoUyqsBu4L",
  "nozFrhfnNGoyqwVuwPAW4aaGqempx4PU6g6D9CJMv7Z",
  "nozievPk7HyK1Rqy1MPJwVQ7qQg2QoJGyP71oeDwbsu",
  "noznbgwYnBLDHu8wcQVCEw6kDrXkPdKkydGJGNXGvL7",
  "nozNVWs5N8mgzuD3qigrCG2UoKxZttxzZ85pvAQVrbP",
  "nozpEGbwx4BcGp6pvEdAh1JoC2CQGZdU6HbNP1v2p6P",
  "nozrhjhkCr3zXT3BiT4WCodYCUFeQvcdUkM7MqhKqge",
  "nozrwQtWhEdrA6W8dkbt9gnUaMs52PdAv5byipnadq3",
  "nozUacTVWub3cL4mJmGCYjKZTnE9RbdY5AP46iQgbPJ",
  "nozWCyTPppJjRuw2fpzDhhWbW355fzosWSzrrMYB1Qk",
  "nozWNju6dY353eMkMqURqwQEoM3SFgEKC6psLCSfUne",
  "nozxNBgWohjR75vdspfxR5H9ceC7XXH99xpxhVGt3Bb",
] as const;

type NozomiError = {
  errorType: "NOZOMI_TX_ERROR";
  errorMessage: string;
  raw: any;
};

export type NozomiSendResult =
  | { ok: true; value: string } // signature
  | { ok: false; error: NozomiError };

function getRandomNozomiTipAddress(): string {
  const idx = Math.floor(Math.random() * NOZOMI_TIP_ADDRESSES.length);
  return NOZOMI_TIP_ADDRESSES[idx];
}

export function getRandomNozomiTipPubkey(): PublicKey {
  return new PublicKey(getRandomNozomiTipAddress());
}

export async function sendNozomiTransaction({
  userWallet,
  versionedTx,
  shouldWaitForConfirmation = false,
}: {
  versionedTx: VersionedTransaction;
  userWallet: PrivyWallet;
  shouldWaitForConfirmation?: boolean;
}) {
  const { signed_transaction: txnBase64 } = await privy
    .wallets()
    .solana()
    .signTransaction(userWallet.id ?? "", {
      address: userWallet.address,
      authorization_context: privyAuthContext,
      transaction: versionedTx.serialize(),
    });

  console.log("Create position", txnBase64);
  const signedTx = VersionedTransaction.deserialize(
    Buffer.from(txnBase64, "base64"),
  );
  const signature = bs58.encode(signedTx.signatures[0]);

  const response = await fetch(
    `https://nozomi.temporal.xyz/api/sendTransaction2?c=${NOZOMI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: txnBase64,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Transaction failed with status ${response.status}: ${errorText}`,
    );
  }

  console.log("Response", response);
  if (shouldWaitForConfirmation) {
    const status = await fastTransactionConfirm([signature]);
    if (status[0]?.err) {
      console.error("Nozomi transaction failed", status[0]?.err);
      throw new Error(JSON.stringify(status[0]?.err));
    }
  }

  return signature;
}
