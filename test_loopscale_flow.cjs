/**
 * Test Loopscale Flash Borrow Flow
 * This script tests the full leverage loop with minimal capital
 */

const {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  VersionedMessage,
} = require("@solana/web3.js");
const bs58 = require("bs58");

// Configuration
const LOOPSCALE_BASE_URL = "https://case.loopscale.com/v1";
const RPC_URL = "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDC_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

// Test parameters - MINIMAL for safety
const COLLATERAL_USDC = 5; // $5 USDC collateral
const LEVERAGE = 1.5; // 1.5x leverage (borrow $2.50)
const BORROW_AMOUNT_RAW = Math.floor(
  COLLATERAL_USDC * (LEVERAGE - 1) * 1_000_000,
); // In USDC decimals (6)

async function main() {
  const privateKeyBase58 = process.argv[2];
  if (!privateKeyBase58) {
    console.error("Usage: node test_loopscale_flow.cjs <base58_private_key>");
    process.exit(1);
  }

  // Decode wallet
  const dec = bs58.default || bs58;
  const secretKey = dec.decode(privateKeyBase58);
  const wallet = Keypair.fromSecretKey(secretKey);
  const walletAddress = wallet.publicKey.toBase58();

  console.log("🔑 Wallet:", walletAddress);
  console.log("💰 Test Parameters:");
  console.log(`   Collateral: $${COLLATERAL_USDC} USDC`);
  console.log(`   Leverage: ${LEVERAGE}x`);
  console.log(
    `   Borrow Amount: ${BORROW_AMOUNT_RAW / 1_000_000} USDC (${BORROW_AMOUNT_RAW} raw)`,
  );

  const connection = new Connection(RPC_URL, "confirmed");

  // Step 1: Get quote
  console.log("\n📊 Step 1: Fetching Loopscale quote...");
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
        {
          amount: 0,
          assetData: { Spl: { mint: SOL_USDC_POOL } },
        },
      ],
      priceOverride: 1,
    }),
  });

  if (!quoteResponse.ok) {
    throw new Error(`Quote API failed: ${quoteResponse.status}`);
  }

  const quotes = await quoteResponse.json();
  console.log("   Quote received:", JSON.stringify(quotes[0], null, 2));

  const quote = quotes[0];
  if (!quote) {
    throw new Error("No quote available");
  }

  // Step 2: Derive PDAs
  console.log("\n🔐 Step 2: Deriving PDAs...");
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
  console.log("   Loan PDA:", loanPda.toBase58());
  console.log("   Loan Nonce:", loanNonce);

  // Get active bin from pool (simplified - in production would query pool state)
  const activeBinId = -4857; // Approximate for SOL/USDC
  const lowerBinId = activeBinId - 10;
  const upperBinId = activeBinId + 10;
  const width = upperBinId - lowerBinId + 1;

  // Derive position PDA
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
  console.log("   Position PDA:", positionPda.toBase58());

  // Step 3: Build flash_borrow request
  console.log("\n📝 Step 3: Building flash_borrow request...");

  // Calculate amounts (simplified - equal split for test)
  const totalRaw = Math.floor(COLLATERAL_USDC * 1_000_000) + BORROW_AMOUNT_RAW;
  const xRawAmount = 0; // SOL amount (we're depositing USDC only for simplicity)
  const yRawAmount = totalRaw; // USDC amount

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
              amountX: xRawAmount,
              amountY: yRawAmount,
              activeId: activeBinId,
              maxActiveBinSlippage: 250,
              strategyParameters: {
                minBinId: lowerBinId,
                maxBinId: upperBinId,
                strategyType: "spotImBalanced", // One-sided USDC
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

  console.log("   Request:", JSON.stringify(flashBorrowRequest, null, 2));

  // Step 4: Call flash_borrow API
  console.log("\n🚀 Step 4: Calling flash_borrow API...");
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
    console.error("❌ Flash borrow API failed:", flashBorrowResponse.status);
    console.error("   Error:", errorText);
    process.exit(1);
  }

  const flashBorrowData = await flashBorrowResponse.json();
  console.log("   ✅ API Response received");
  console.log("   Loan Address:", flashBorrowData.loanAddress);
  console.log("   Transactions:", flashBorrowData.transactions.length);

  // Step 5: Simulate transaction
  console.log("\n🔬 Step 5: Simulating transaction...");

  for (let i = 0; i < flashBorrowData.transactions.length; i++) {
    const tx = flashBorrowData.transactions[i];
    const rawMsg = Buffer.from(tx.message, "base64");
    const msg = VersionedMessage.deserialize(rawMsg);

    const vtx = new VersionedTransaction(msg);

    // Allocate signature slots
    vtx.signatures = Array(msg.header.numRequiredSignatures).fill(
      Buffer.alloc(64),
    );

    // Apply program signatures from API
    for (const s of tx.signatures) {
      const pk = new PublicKey(s.publicKey);
      const idx = msg.staticAccountKeys.findIndex((k) => k.equals(pk));
      if (idx !== -1) {
        vtx.signatures[idx] = Buffer.from(s.signature, "base64");
      }
    }

    // Sign with our wallet
    vtx.sign([wallet]);

    // Simulate
    console.log(
      `   Simulating tx ${i + 1}/${flashBorrowData.transactions.length}...`,
    );
    const simResult = await connection.simulateTransaction(vtx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });

    if (simResult.value.err) {
      console.error(
        `   ❌ Simulation failed for tx ${i + 1}:`,
        simResult.value.err,
      );
      console.error("   Logs:", simResult.value.logs?.slice(-10));
      process.exit(1);
    }

    console.log(`   ✅ Tx ${i + 1} simulation passed`);
    console.log(`   CU used: ${simResult.value.unitsConsumed}`);
  }

  console.log("\n✅ All simulations passed!");
  console.log("\n⚠️  SIMULATION ONLY - Transaction not submitted");
  console.log("To submit for real, pass --execute flag");

  // Only execute if --execute flag is passed
  if (process.argv.includes("--execute")) {
    console.log("\n🚀 Step 6: Executing transaction...");
    // TODO: Add actual submission logic
    console.log("   [Execution code would go here]");
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
