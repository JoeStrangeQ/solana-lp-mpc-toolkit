/**
 * Test Loopscale Double-Sided DLMM Position
 * Uses both SOL and USDC as collateral
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

// Token mints
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_USDC_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

// Position parameters (adjusted for available balance)
const COLLATERAL_USDC_VALUE = 10; // $10 worth of USDC
const COLLATERAL_SOL_VALUE = 10; // $10 worth of SOL
const SOL_PRICE = 116.79; // Current SOL price
const LEVERAGE = 2.0;

// Calculate amounts
const USDC_AMOUNT = COLLATERAL_USDC_VALUE;
const SOL_AMOUNT = COLLATERAL_SOL_VALUE / SOL_PRICE; // ~0.214 SOL

const USDC_RAW = Math.floor(USDC_AMOUNT * 1_000_000); // 6 decimals
const SOL_RAW = Math.floor(SOL_AMOUNT * 1_000_000_000); // 9 decimals (lamports)

// Borrow amount (to reach target leverage)
const TOTAL_COLLATERAL_VALUE = COLLATERAL_USDC_VALUE + COLLATERAL_SOL_VALUE;
const BORROW_VALUE = TOTAL_COLLATERAL_VALUE * (LEVERAGE - 1);
const BORROW_RAW = Math.floor(BORROW_VALUE * 1_000_000);

console.log("=== Double-Sided Position Config ===");
console.log(
  `Collateral: $${COLLATERAL_SOL_VALUE} SOL (${SOL_AMOUNT.toFixed(4)} SOL) + $${COLLATERAL_USDC_VALUE} USDC`,
);
console.log(`Borrow: $${BORROW_VALUE} USDC`);
console.log(`Total Position: $${TOTAL_COLLATERAL_VALUE + BORROW_VALUE}`);
console.log(`Leverage: ${LEVERAGE}x`);
console.log("");

// Parse active bin from pool account data
function parseActiveBinId(data) {
  const buffer = Buffer.from(data, "base64");
  for (const offset of [40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80]) {
    const val = buffer.readInt32LE(offset);
    if (val > -7000 && val < -3000) {
      return val;
    }
  }
  return -4800; // Fallback for ~$117 SOL
}

async function main() {
  const privateKeyBase58 = process.argv[2];
  if (!privateKeyBase58) {
    console.error(
      "Usage: node test_double_sided.cjs <base58_private_key> [--execute]",
    );
    process.exit(1);
  }

  const dec = bs58.default || bs58;
  const secretKey = dec.decode(privateKeyBase58);
  const wallet = Keypair.fromSecretKey(secretKey);
  const walletAddress = wallet.publicKey.toBase58();

  console.log("🔑 Wallet:", walletAddress);

  const connection = new Connection(RPC_URL, "confirmed");

  // Check balances first
  console.log("\n💰 Checking balances...");
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(
    `   SOL: ${(solBalance / 1e9).toFixed(4)} (need ${SOL_AMOUNT.toFixed(4)} + gas)`,
  );

  // Get USDC balance
  const usdcAta = PublicKey.findProgramAddressSync(
    [
      wallet.publicKey.toBuffer(),
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
      new PublicKey(USDC_MINT).toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  )[0];

  const usdcInfo = await connection
    .getTokenAccountBalance(usdcAta)
    .catch(() => null);
  const usdcBalance = usdcInfo ? parseFloat(usdcInfo.value.uiAmount) : 0;
  console.log(`   USDC: ${usdcBalance.toFixed(2)} (need ${USDC_AMOUNT})`);

  if (solBalance / 1e9 < SOL_AMOUNT + 0.01) {
    console.error("❌ Not enough SOL!");
    process.exit(1);
  }
  if (usdcBalance < USDC_AMOUNT) {
    console.error("❌ Not enough USDC!");
    process.exit(1);
  }

  // Step 1: Get pool state for active bin
  console.log("\n📊 Step 1: Fetching pool state...");
  const poolInfo = await connection.getAccountInfo(
    new PublicKey(SOL_USDC_POOL),
  );
  const activeBinId = parseActiveBinId(poolInfo.data.toString("base64"));
  console.log("   Active Bin:", activeBinId);

  // Use 31-bin range centered on active bin (can expand to 69 later)
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
  if (!quotes || !quotes[0]) {
    console.error("❌ No quotes available");
    process.exit(1);
  }
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

  // Step 4: Build double-sided request
  console.log("\n📝 Step 4: Building double-sided request...");

  // Total amounts going into the position (collateral + borrowed)
  // For double-sided: we add SOL (amountX) + USDC collateral + borrowed USDC (amountY)
  const totalUsdcRaw = USDC_RAW + BORROW_RAW;

  console.log(
    `   SOL deposit: ${(SOL_RAW / 1e9).toFixed(4)} SOL (${SOL_RAW} lamports)`,
  );
  console.log(
    `   USDC deposit: ${(totalUsdcRaw / 1e6).toFixed(2)} USDC (${USDC_RAW} collateral + ${BORROW_RAW} borrowed)`,
  );

  const flashBorrowRequest = {
    depositMint: USDC_MINT, // Primary deposit is USDC
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
              amountX: SOL_RAW, // SOL amount (lamports)
              amountY: totalUsdcRaw, // USDC amount (6 decimals)
              activeId: activeBinId,
              maxActiveBinSlippage: 2000,
              strategyParameters: {
                minBinId: lowerBinId,
                maxBinId: upperBinId,
                strategyType: "spotBalanced", // Double-sided strategy
                parameteres: new Array(64).fill(0),
              },
            },
          },
        },
      },
    ],
    // SOL needs to be provided separately since depositMint is USDC
    additionalDeposits: [
      {
        mint: WSOL_MINT,
        amount: SOL_RAW,
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
    console.error("❌ API failed:", flashBorrowResponse.status);
    console.error("   Response:", errorText);

    // Try without additionalDeposits if that was the issue
    if (
      errorText.includes("additionalDeposits") ||
      errorText.includes("unknown field")
    ) {
      console.log("\n🔄 Retrying without additionalDeposits...");
      delete flashBorrowRequest.additionalDeposits;

      const retryResponse = await fetch(
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

      if (!retryResponse.ok) {
        const retryError = await retryResponse.text();
        console.error("❌ Retry also failed:", retryError);
        process.exit(1);
      }

      const retryData = await retryResponse.json();
      console.log("   ✅ Loan Address:", retryData.loanAddress);
      await simulateAndExecute(connection, wallet, retryData);
      return;
    }

    process.exit(1);
  }

  const flashBorrowData = await flashBorrowResponse.json();
  console.log("   ✅ Loan Address:", flashBorrowData.loanAddress);

  await simulateAndExecute(connection, wallet, flashBorrowData);
}

async function simulateAndExecute(connection, wallet, flashBorrowData) {
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
    console.error("   Last logs:");
    logs.slice(-10).forEach((l) => console.error("     ", l));
    process.exit(1);
  }

  console.log("   ✅ SIMULATION PASSED!");
  console.log("   CU used:", simResult.value.unitsConsumed);

  // Step 7: Execute
  if (process.argv.includes("--execute")) {
    console.log("\n🚀 Step 7: EXECUTING ON MAINNET...");

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
      console.log("   ✅ SUCCESS!");
      console.log("   🔗 https://solscan.io/tx/" + signature);
    }
  } else {
    console.log(
      "\n✅ Simulation passed! Run with --execute to submit on mainnet.",
    );
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
