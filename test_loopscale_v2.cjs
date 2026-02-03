/**
 * Test Loopscale Flash Borrow Flow v2
 * Uses Meteora SDK to get real active bin
 */

const {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  VersionedMessage,
} = require("@solana/web3.js");
const bs58 = require("bs58");
const DLMM = require("@meteora-ag/dlmm").default;

// Configuration
const LOOPSCALE_BASE_URL = "https://case.loopscale.com/v1";
const RPC_URL = "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDC_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

// Test parameters
const COLLATERAL_USDC = 5;
const LEVERAGE = 1.5;
const BORROW_AMOUNT_RAW = Math.floor(
  COLLATERAL_USDC * (LEVERAGE - 1) * 1_000_000,
);

async function main() {
  const privateKeyBase58 = process.argv[2];
  if (!privateKeyBase58) {
    console.error(
      "Usage: node test_loopscale_v2.cjs <base58_private_key> [--execute]",
    );
    process.exit(1);
  }

  const dec = bs58.default || bs58;
  const secretKey = dec.decode(privateKeyBase58);
  const wallet = Keypair.fromSecretKey(secretKey);
  const walletAddress = wallet.publicKey.toBase58();

  console.log("🔑 Wallet:", walletAddress);
  console.log("💰 Test: $5 USDC @ 1.5x leverage (borrow $2.50)");

  const connection = new Connection(RPC_URL, "confirmed");

  // Step 1: Get real active bin from Meteora
  console.log("\n📊 Step 1: Fetching pool state from Meteora...");
  const dlmmPool = await DLMM.create(connection, new PublicKey(SOL_USDC_POOL));
  const activeBin = await dlmmPool.getActiveBin();

  console.log("   Active Bin ID:", activeBin.binId);
  console.log("   Price:", activeBin.pricePerToken);

  const activeBinId = activeBin.binId;
  const lowerBinId = activeBinId - 10;
  const upperBinId = activeBinId + 10;
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
  console.log("   APY:", quote.apy / 10000 + "%");
  console.log("   LTV:", quote.ltv / 10000 + "%");
  console.log("   Strategy:", quote.strategy);

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

  // Step 4: Build flash_borrow request
  console.log("\n📝 Step 4: Building flash_borrow request...");
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
              maxActiveBinSlippage: 500, // Increased tolerance
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
    console.error("❌ API failed:", flashBorrowResponse.status, errorText);
    process.exit(1);
  }

  const flashBorrowData = await flashBorrowResponse.json();
  console.log("   ✅ Loan Address:", flashBorrowData.loanAddress);
  console.log("   Transactions:", flashBorrowData.transactions.length);

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
    console.error("   ❌ Simulation failed:", simResult.value.err);
    console.error("   Last logs:", simResult.value.logs?.slice(-5).join("\n"));
    process.exit(1);
  }

  console.log("   ✅ Simulation passed!");
  console.log("   CU used:", simResult.value.unitsConsumed);

  // Step 7: Execute if flag passed
  if (process.argv.includes("--execute")) {
    console.log("\n🚀 Step 7: EXECUTING FOR REAL...");

    // Get fresh blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    // Re-deserialize with fresh blockhash
    const freshMsg = VersionedMessage.deserialize(rawMsg);
    // Note: Can't easily replace blockhash in VersionedMessage, so we use the one from API

    const freshVtx = new VersionedTransaction(msg);
    freshVtx.signatures = Array(msg.header.numRequiredSignatures).fill(
      Buffer.alloc(64),
    );
    for (const s of tx.signatures) {
      const pk = new PublicKey(s.publicKey);
      const idx = msg.staticAccountKeys.findIndex((k) => k.equals(pk));
      if (idx !== -1)
        freshVtx.signatures[idx] = Buffer.from(s.signature, "base64");
    }
    freshVtx.sign([wallet]);

    const signature = await connection.sendTransaction(freshVtx, {
      skipPreflight: false,
      maxRetries: 3,
    });

    console.log("   📤 Submitted:", signature);
    console.log("   ⏳ Confirming...");

    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: msg.recentBlockhash,
        lastValidBlockHeight: lastValidBlockHeight + 150,
      },
      "confirmed",
    );

    if (confirmation.value.err) {
      console.error("   ❌ Transaction failed:", confirmation.value.err);
    } else {
      console.log("   ✅ SUCCESS!");
      console.log("   🔗 https://solscan.io/tx/" + signature);
    }
  } else {
    console.log("\n✅ Simulation complete. Run with --execute to submit.");
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
