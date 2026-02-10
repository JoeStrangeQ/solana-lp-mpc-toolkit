/**
 * Orca Whirlpool position discovery
 *
 * Discovers positions by scanning token accounts for Whirlpool position NFTs,
 * then fetching position data from the SDK.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getWhirlpoolClient, getWhirlpoolCtx } from './client.js';
import { PDAUtil, PriceMath, PoolUtil, ORCA_WHIRLPOOL_PROGRAM_ID } from '@orca-so/whirlpools-sdk';
import BN from 'bn.js';
import type { OrcaPositionInfo } from './types.js';

/**
 * Discover all Orca Whirlpool positions for a wallet.
 *
 * Strategy: scan all token accounts for amount=1 NFTs, derive position PDA
 * for each mint, then batch-fetch positions from the SDK.
 */
export async function discoverOrcaPositions(
  connection: Connection,
  walletAddress: string,
): Promise<OrcaPositionInfo[]> {
  try {
    const owner = new PublicKey(walletAddress);
    const client = getWhirlpoolClient(connection);
    const ctx = getWhirlpoolCtx(connection);
    const programId = ctx.program.programId;

    // 1. Get all token accounts owned by the wallet (amount = 1 NFTs)
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    });

    // Filter for NFTs (amount == 1, decimals == 0)
    const nftMints: PublicKey[] = [];
    for (const { account } of tokenAccounts.value) {
      const parsed = account.data.parsed?.info;
      if (
        parsed &&
        parsed.tokenAmount?.uiAmount === 1 &&
        parsed.tokenAmount?.decimals === 0
      ) {
        nftMints.push(new PublicKey(parsed.mint));
      }
    }

    if (nftMints.length === 0) return [];

    // 2. Derive position PDAs for each NFT mint and batch-fetch
    const positionAddresses: string[] = [];
    const mintToAddress = new Map<string, string>();

    for (const mint of nftMints) {
      const pda = PDAUtil.getPosition(programId, mint);
      positionAddresses.push(pda.publicKey.toBase58());
      mintToAddress.set(pda.publicKey.toBase58(), mint.toBase58());
    }

    // Batch fetch - getPositions returns Record<string, Position | null>
    const positionsMap = await client.getPositions(positionAddresses);

    const result: OrcaPositionInfo[] = [];

    for (const [addrStr, positionOrNull] of Object.entries(positionsMap)) {
      if (!positionOrNull) continue;
      try {
        const posData = positionOrNull.getData();
        const pool = await client.getPool(posData.whirlpool);
        const poolData = pool.getData();
        const tokenAInfo = pool.getTokenAInfo();
        const tokenBInfo = pool.getTokenBInfo();

        const currentTick = poolData.tickCurrentIndex;
        const inRange =
          currentTick >= posData.tickLowerIndex &&
          currentTick < posData.tickUpperIndex;

        const decimalsA = tokenAInfo.decimals;
        const decimalsB = tokenBInfo.decimals;

        const priceLower = PriceMath.tickIndexToPrice(
          posData.tickLowerIndex, decimalsA, decimalsB,
        ).toNumber();
        const priceUpper = PriceMath.tickIndexToPrice(
          posData.tickUpperIndex, decimalsA, decimalsB,
        ).toNumber();
        const priceCurrent = PriceMath.tickIndexToPrice(
          currentTick, decimalsA, decimalsB,
        ).toNumber();

        // Calculate token amounts from liquidity
        const sqrtPriceLowerX64 = PriceMath.tickIndexToSqrtPriceX64(posData.tickLowerIndex);
        const sqrtPriceUpperX64 = PriceMath.tickIndexToSqrtPriceX64(posData.tickUpperIndex);
        const sqrtPriceCurrentX64 = poolData.sqrtPrice;

        const { tokenA: tokenAmountA, tokenB: tokenAmountB } = PoolUtil.getTokenAmountsFromLiquidity(
          posData.liquidity,
          sqrtPriceCurrentX64,
          sqrtPriceLowerX64,
          sqrtPriceUpperX64,
          true, // round up
        );

        const amountADecimal = Number(tokenAmountA.toString()) / Math.pow(10, decimalsA);
        const amountBDecimal = Number(tokenAmountB.toString()) / Math.pow(10, decimalsB);

        const mintAddress = mintToAddress.get(addrStr) || '';

        result.push({
          address: addrStr,
          mintAddress,
          poolAddress: posData.whirlpool.toBase58(),
          poolName: `${tokenAInfo.mint.toBase58().slice(0, 4)}-${tokenBInfo.mint.toBase58().slice(0, 4)}`,
          tickLowerIndex: posData.tickLowerIndex,
          tickUpperIndex: posData.tickUpperIndex,
          liquidity: posData.liquidity.toString(),
          tokenA: { amount: amountADecimal.toFixed(6), symbol: tokenAInfo.mint.toBase58().slice(0, 6) },
          tokenB: { amount: amountBDecimal.toFixed(6), symbol: tokenBInfo.mint.toBase58().slice(0, 6) },
          fees: {
            tokenA: (Number(posData.feeOwedA.toString()) / Math.pow(10, decimalsA)).toFixed(6),
            tokenB: (Number(posData.feeOwedB.toString()) / Math.pow(10, decimalsB)).toFixed(6),
          },
          inRange,
          priceLower,
          priceUpper,
          priceCurrent,
          dex: 'orca',
        });
      } catch (err) {
        console.warn(`[Orca] Failed to load position ${addrStr}:`, err);
      }
    }

    return result;
  } catch (error) {
    console.error('[Orca] Position discovery error:', error);
    return [];
  }
}
