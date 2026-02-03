/**
 * Quick test to find working amount/leverage combinations
 */

const {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  VersionedMessage,
} = require("@solana/web3.js");
const bs58 = require("bs58");

const LOOPSCALE_BASE_URL = "https://case.loopscale.com/v1";
const RPC_URL = "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDC_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

// Parse from args: node test_amounts.cjs <key> <collateral> <leverage>
const COLLATERAL = parseFloat(process.argv[3]) || 5;
const LEVERAGE = parseFloat(process.argv[4]) || 1.5;
const BORROW_RAW = Math.floor(COLLATERAL * (LEVERAGE - 1) * 1_000_000);

function parseActiveBinId(data) {
  const buffer = Buffer.from(data, "base64");
  for (const offset of [40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80]) {
    const val = buffer.readInt32LE(offset);
    if (val > -7000 && val < -3000) return val;
  }
  return -4800;
}

async function main() {
  const privateKeyBase58 = process.argv[2];
  if (!privateKeyBase58) {
    console.error("Usage: node test_amounts.cjs <key> [collateral] [leverage]");
    process.exit(1);
  }

  console.log(
    `Testing: $${COLLATERAL} @ ${LEVERAGE}x = $${(COLLATERAL * LEVERAGE).toFixed(2)} position`,
  );

  const dec = bs58.default || bs58;
  const wallet = Keypair.fromSecretKey(dec.decode(privateKeyBase58));
  const walletAddress = wallet.publicKey.toBase58();
  const connection = new Connection(RPC_URL, "confirmed");

  const poolInfo = await connection.getAccountInfo(
    new PublicKey(SOL_USDC_POOL),
  );
  const activeBinId = parseActiveBinId(poolInfo.data.toString("base64"));

  const lowerBinId = activeBinId - 15;
  const upperBinId = activeBinId + 15;
  const width = upperBinId - lowerBinId + 1;

  const quoteRes = await fetch(`${LOOPSCALE_BASE_URL}/markets/quote/max`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-wallet": walletAddress,
    },
    body: JSON.stringify({
      userWallet: walletAddress,
      durationType: 0,
      duration: 1,
      principalMint: USDC_MINT,
      collateralFilter: [
        { amount: 0, assetData: { Spl: { mint: SOL_USDC_POOL } } },
      ],
      priceOverride: 1,
    }),
  });
  const quote = (await quoteRes.json())[0];

  const LOOPSCALE_PROGRAM_ID = new PublicKey(
    "sboXjDPocEasbTKokLUiNb1NrnikbBBZCooXKrjZkZd",
  );
  const METEORA_PROGRAM_ID = new PublicKey(
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  );

  const loanNonce = Math.floor(100000 + Math.random() * 900000);
  const u64LoanNonce = Buffer.allocUnsafe(8);
  u64LoanNonce.writeBigUInt64LE(BigInt(loanNonce), 0);

  const [loanPda] = PublicKey.findProgramAddressSync(
    [wallet.publicKey.toBuffer(), u64LoanNonce],
    LOOPSCALE_PROGRAM_ID,
  );
  const [positionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      new PublicKey(SOL_USDC_POOL).toBuffer(),
      loanPda.toBuffer(),
      Buffer.from(new Int32Array([lowerBinId]).buffer),
      Buffer.from(new Int32Array([width]).buffer),
    ],
    METEORA_PROGRAM_ID,
  );

  const totalRaw = Math.floor(COLLATERAL * 1_000_000) + BORROW_RAW;

  const flashRes = await fetch(
    `${LOOPSCALE_BASE_URL}/markets/creditbook/flash_borrow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-wallet": walletAddress,
      },
      body: JSON.stringify({
        depositMint: USDC_MINT,
        principalRequested: [
          {
            ledgerIndex: 0,
            durationIndex: 0,
            principalAmount: BORROW_RAW,
            principalMint: USDC_MINT,
            strategy: quote.strategy,
            expectedLoanValues: {
              expectedApy: quote.apy,
              expectedLqt: [quote.lqt, 0, 0, 0, 0],
            },
          },
        ],
        depositCollateral: [
          {
            collateralAmount: 1,
            collateralAssetData: {
              Meteora: {
                positionAddress: positionPda.toBase58(),
                lbPair: SOL_USDC_POOL,
              },
            },
            loanCreationParams: {
              MeteoraDlmmPositionCreate: {
                minBinId: lowerBinId,
                width: width,
                liquidityParameter: {
                  amountX: 0,
                  amountY: totalRaw,
                  activeId: activeBinId,
                  maxActiveBinSlippage: 2000,
                  strategyParameters: {
                    minBinId: lowerBinId,
                    maxBinId: upperBinId,
                    strategyType: "spotImBalanced",
                    parameteres: new Array(64).fill(0),
                  },
                },
              },
            },
          },
        ],
        cpiIxs: [],
        setupIxs: [],
        unifySetup: true,
      }),
    },
  );

  if (!flashRes.ok) {
    console.log("❌ API failed:", await flashRes.text());
    process.exit(1);
  }

  const flashData = await flashRes.json();
  const tx = flashData.transactions[0];
  const msg = VersionedMessage.deserialize(Buffer.from(tx.message, "base64"));
  const vtx = new VersionedTransaction(msg);
  vtx.signatures = Array(msg.header.numRequiredSignatures).fill(
    Buffer.alloc(64),
  );
  for (const s of tx.signatures) {
    const idx = msg.staticAccountKeys.findIndex((k) =>
      k.equals(new PublicKey(s.publicKey)),
    );
    if (idx !== -1) vtx.signatures[idx] = Buffer.from(s.signature, "base64");
  }
  vtx.sign([wallet]);

  const simResult = await connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  if (simResult.value.err) {
    console.log(
      `❌ $${COLLATERAL} @ ${LEVERAGE}x FAILED:`,
      JSON.stringify(simResult.value.err),
    );
  } else {
    console.log(
      `✅ $${COLLATERAL} @ ${LEVERAGE}x PASSED! CU: ${simResult.value.unitsConsumed}`,
    );
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
