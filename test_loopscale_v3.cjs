/**
 * Test Loopscale Flash Borrow Flow v3
 * Queries active bin via RPC directly
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

const COLLATERAL_USDC = 5;
const LEVERAGE = 1.5;
const BORROW_AMOUNT_RAW = Math.floor(
  COLLATERAL_USDC * (LEVERAGE - 1) * 1_000_000,
);

// Parse active bin from pool account data (offset based on Meteora DLMM struct)
function parseActiveBinId(data) {
  // LbPair struct layout - activeId is at offset ~40 bytes after the header
  // This is an approximation - in production use the SDK
  const buffer = Buffer.from(data, "base64");
  // Try reading as signed 32-bit int at various offsets
  for (const offset of [40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80]) {
    const val = buffer.readInt32LE(offset);
    // SOL/USDC active bin should be in range -6000 to -4000 typically
    if (val > -7000 && val < -3000) {
      return val;
    }
  }
  // Fallback based on current SOL price (~$240 = bin around -4700)
  return -4700;
}

async function main() {
  const privateKeyBase58 = process.argv[2];
  if (!privateKeyBase58) {
    console.error(
      "Usage: node test_loopscale_v3.cjs <base58_private_key> [--execute]",
    );
    process.exit(1);
  }

  const dec = bs58.default || bs58;
  const secretKey = dec.decode(privateKeyBase58);
  const wallet = Keypair.fromSecretKey(secretKey);
  const walletAddress = wallet.publicKey.toBase58();

  console.log("🔑 Wallet:", walletAddress);
  console.log("💰 Test: $5 USDC @ 1.5x leverage");

  const connection = new Connection(RPC_URL, "confirmed");

  // Step 1: Get pool data to find active bin
  console.log("\n📊 Step 1: Fetching pool state...");
  const poolInfo = await connection.getAccountInfo(
    new PublicKey(SOL_USDC_POOL),
  );

  let activeBinId = parseActiveBinId(poolInfo.data.toString("base64"));
  console.log("   Estimated Active Bin:", activeBinId);

  // Use wider range and higher slippage for safety
  const lowerBinId = activeBinId - 15;
  const upperBinId = activeBinId + 15;
  const width = upperBinId - lowerBinId + 1;
  console.log(`   Range: ${lowerBinId} to ${upperBinId} (width: ${width})`);

  // Step 2: Get quote
  console.log("\n📈 Step 2: Fetching Loopscale quote...");
  const quoteResponse = await fetch(`${LOOPSCALE_BASE_URL}/markets/quote/max`, {
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

  const quotes = await quoteResponse.json();
  const quote = quotes[0];
  console.log(
    "   APY:",
    quote.apy / 10000 + "%",
    "| LTV:",
    quote.ltv / 10000 + "%",
  );

  // Step 3: Derive PDAs
  console.log("\n🔐 Step 3: Deriving PDAs...");
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

  console.log("   Loan PDA:", loanPda.toBase58());
  console.log("   Position PDA:", positionPda.toBase58());

  // Step 4: Build request with HIGH slippage tolerance
  console.log("\n📝 Step 4: Building request...");
  const totalRaw = Math.floor(COLLATERAL_USDC * 1_000_000) + BORROW_AMOUNT_RAW;

  const flashBorrowRequest = {
    depositMint: USDC_MINT,
    principalRequested: [
      {
        ledgerIndex: 0,
        durationIndex: 0,
        principalAmount: BORROW_AMOUNT_RAW,
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
              maxActiveBinSlippage: 2000, // Very high slippage (20 bins)
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
  };

  // Step 5: Call API
  console.log("\n🚀 Step 5: Calling flash_borrow API...");
  const flashBorrowResponse = await fetch(
    `${LOOPSCALE_BASE_URL}/markets/creditbook/flash_borrow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-wallet": walletAddress,
      },
      body: JSON.stringify(flashBorrowRequest),
    },
  );

  if (!flashBorrowResponse.ok) {
    const errorText = await flashBorrowResponse.text();
    console.error("❌ API failed:", errorText);
    process.exit(1);
  }

  const flashBorrowData = await flashBorrowResponse.json();
  console.log("   ✅ Loan Address:", flashBorrowData.loanAddress);

  // Step 6: Simulate
  console.log("\n🔬 Step 6: Simulating...");

  const tx = flashBorrowData.transactions[0];
  const rawMsg = Buffer.from(tx.message, "base64");
  const msg = VersionedMessage.deserialize(rawMsg);

  const vtx = new VersionedTransaction(msg);
  vtx.signatures = Array(msg.header.numRequiredSignatures).fill(
    Buffer.alloc(64),
  );

  for (const s of tx.signatures) {
    const pk = new PublicKey(s.publicKey);
    const idx = msg.staticAccountKeys.findIndex((k) => k.equals(pk));
    if (idx !== -1) vtx.signatures[idx] = Buffer.from(s.signature, "base64");
  }

  vtx.sign([wallet]);

  const simResult = await connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  if (simResult.value.err) {
    console.error(
      "   ❌ Simulation failed:",
      JSON.stringify(simResult.value.err),
    );
    const logs = simResult.value.logs || [];
    console.error("   Logs:", logs.slice(-5).join("\n       "));
    process.exit(1);
  }

  console.log("   ✅ SIMULATION PASSED!");
  console.log("   CU used:", simResult.value.unitsConsumed);

  // Step 7: Execute
  if (process.argv.includes("--execute")) {
    console.log("\n🚀 Step 7: EXECUTING...");

    const signature = await connection.sendTransaction(vtx, {
      skipPreflight: false,
      maxRetries: 3,
    });

    console.log("   📤 Tx:", signature);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed",
    );

    if (confirmation.value.err) {
      console.error("   ❌ Failed:", confirmation.value.err);
    } else {
      console.log("   ✅ SUCCESS! https://solscan.io/tx/" + signature);
    }
  } else {
    console.log("\n✅ Ready! Run with --execute to submit for real.");
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
