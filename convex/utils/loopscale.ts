import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Address } from "./solana";
import { LOOPSCALE_PROGRAM_ID, LoopscaleIx } from "../services/loopscale";

export function deriveLoanPda({
  userAddress,
  loanNonce,
}: {
  userAddress: Address;
  loanNonce?: number;
}) {
  const finalLoanNonce =
    loanNonce ?? Math.floor(100000 + Math.random() * 900000);

  const walletPubkey = new PublicKey(userAddress);
  const loopscaleProgramId = new PublicKey(LOOPSCALE_PROGRAM_ID);
  const u64LoanNonce = Buffer.allocUnsafe(8);
  u64LoanNonce.writeBigUInt64LE(BigInt(finalLoanNonce), 0);
  const [loanPda] = PublicKey.findProgramAddressSync(
    [walletPubkey.toBuffer(), u64LoanNonce],
    loopscaleProgramId,
  );

  return loanPda;
}

export function toLoopscaleIx(ixs: TransactionInstruction[]): LoopscaleIx[] {
  return ixs.map((ix) => ({
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data).toString("base64"),
  }));
}
