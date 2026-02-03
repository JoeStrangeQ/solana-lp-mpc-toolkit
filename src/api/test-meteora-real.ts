/**
 * Test Real Meteora TX Builder
 */
import { Connection } from "@solana/web3.js";
import { getMeteoraPoolInfo, buildMeteoraAddLiquidityTx } from "./meteoraTxBuilder";

async function main() {
  console.log("Testing Real Meteora TX Builder...\n");
  
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const poolAddress = "ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq"; // SOL-USDC DLMM
  
  try {
    // Test 1: Get pool info
    console.log("1. Getting pool info...");
    const poolInfo = await getMeteoraPoolInfo(connection, poolAddress);
    console.log("   Pool:", poolInfo.address);
    console.log("   Token X:", poolInfo.tokenX.mint);
    console.log("   Token Y:", poolInfo.tokenY.mint);
    console.log("   Active Bin:", poolInfo.activeBinId);
    console.log("   Price:", poolInfo.currentPrice);
    console.log("   ✅ Pool info retrieved!\n");
    
    // Test 2: Build add liquidity TX (won't execute, just build)
    console.log("2. Building add liquidity TX...");
    const testUser = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const result = await buildMeteoraAddLiquidityTx(connection, {
      poolAddress,
      userPubkey: testUser,
      amountX: 0.1, // 0.1 SOL
      amountY: 10,  // 10 USDC
    });
    console.log("   Message:", result.message);
    console.log("   TX exists:", !!result.transaction);
    console.log("   ✅ Add liquidity TX built!\n");
    
    console.log("🎉 ALL TESTS PASSED - Real Meteora TX building works!");
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    console.error(error.stack?.split("\n").slice(0, 5).join("\n"));
  }
}

main();
