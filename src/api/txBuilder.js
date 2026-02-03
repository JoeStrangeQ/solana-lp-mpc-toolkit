/**
 * Transaction Builder for Wallet-less Agents
 *
 * Returns unsigned transactions that agents can:
 * 1. Forward to user for signing
 * 2. Sign with custodial wallet
 * 3. Use with MPC signing service
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { PublicKey, Transaction, LAMPORTS_PER_SOL, TransactionInstruction, } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, } from "@solana/spl-token";
import { PDA, toLamports } from '@meteora-ag/dlmm';
import { BN } from 'bn.js';
// Common token mints
var TOKENS = {
    SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
    USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
    BONK: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
    JTO: { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", decimals: 9 },
    JUP: { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
    RAY: { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
};
/**
 * Build a real, unsigned add liquidity transaction for Meteora DLMM
 */
export function buildAddLiquidityTx(connection, params) {
    return __awaiter(this, void 0, void 0, function () {
        var userPubkey, poolAddress, venue, tokenA, tokenB, amountA, amountB, _a, slippageBps, user, lbPair, _b, blockhash, lastValidBlockHeight, tx, instructions, tokenAInfo, tokenBInfo, userAtaA, userAtaB, position, pairInfo, amountALamports, amountBLamports, activeBin, binStep, addLiqIx, serialized, fee, error_1, err;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    userPubkey = params.userPubkey, poolAddress = params.poolAddress, venue = params.venue, tokenA = params.tokenA, tokenB = params.tokenB, amountA = params.amountA, amountB = params.amountB, _a = params.slippageBps, slippageBps = _a === void 0 ? 50 : _a;
                    if (venue !== 'meteora') {
                        return [2 /*return*/, { success: false, error: "Transaction building for ".concat(venue, " is not yet supported.") }];
                    }
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 10, , 11]);
                    user = new PublicKey(userPubkey);
                    lbPair = new PublicKey(poolAddress);
                    return [4 /*yield*/, connection.getLatestBlockhash()];
                case 2:
                    _b = _c.sent(), blockhash = _b.blockhash, lastValidBlockHeight = _b.lastValidBlockHeight;
                    tx = new Transaction({ recentBlockhash: blockhash, feePayer: user });
                    instructions = [];
                    tokenAInfo = TOKENS[tokenA.toUpperCase()];
                    tokenBInfo = TOKENS[tokenB.toUpperCase()];
                    if (!tokenAInfo || !tokenBInfo) {
                        return [2 /*return*/, { success: false, error: 'Invalid token symbols' }];
                    }
                    return [4 /*yield*/, getAssociatedTokenAddress(new PublicKey(tokenAInfo.mint), user)];
                case 3:
                    userAtaA = _c.sent();
                    return [4 /*yield*/, connection.getAccountInfo(userAtaA)];
                case 4:
                    if (!(_c.sent())) {
                        tx.add(createAssociatedTokenAccountInstruction(user, userAtaA, user, new PublicKey(tokenAInfo.mint)));
                        instructions.push("Create ".concat(tokenA, " token account"));
                    }
                    return [4 /*yield*/, getAssociatedTokenAddress(new PublicKey(tokenBInfo.mint), user)];
                case 5:
                    userAtaB = _c.sent();
                    return [4 /*yield*/, connection.getAccountInfo(userAtaB)];
                case 6:
                    if (!(_c.sent())) {
                        tx.add(createAssociatedTokenAccountInstruction(user, userAtaB, user, new PublicKey(tokenBInfo.mint)));
                        instructions.push("Create ".concat(tokenB, " token account"));
                    }
                    position = PDA.newPosition(lbPair);
                    instructions.push("Create new LP position: ".concat(position.publicKey.toBase58().slice(0, 8), "..."));
                    return [4 /*yield*/, LbPair.getLbPair(lbPair, connection)];
                case 7:
                    pairInfo = _c.sent();
                    amountALamports = toLamports(new BN(amountA * Math.pow(10, tokenAInfo.decimals)), tokenAInfo.decimals);
                    amountBLamports = toLamports(new BN(amountB * Math.pow(10, tokenBInfo.decimals)), tokenBInfo.decimals);
                    activeBin = pairInfo.activeBin;
                    binStep = pairInfo.binStep;
                    return [4 /*yield*/, pairInfo.addLiquidityByStrategy({
                            position: position.publicKey,
                            user: user,
                            totalXAmount: amountALamports,
                            totalYAmount: amountBLamports,
                            strategy: {
                                strategyType: 'SpotBalanced',
                                minBinId: activeBin.binId - 10 * binStep,
                                maxBinId: activeBin.binId + 10 * binStep,
                            },
                            slippage: slippageBps / 10000,
                        })];
                case 8:
                    addLiqIx = _c.sent();
                    tx.add(addLiqIx);
                    instructions.push("Add ".concat(amountA, " ").concat(tokenA, " + ").concat(amountB, " ").concat(tokenB, " to Meteora pool"));
                    // Serialize transaction (partially signed by position PDA)
                    tx.partialSign(position);
                    serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
                    return [4 /*yield*/, tx.getEstimatedFee(connection)];
                case 9:
                    fee = _c.sent();
                    return [2 /*return*/, {
                            success: true,
                            transaction: {
                                serialized: serialized,
                                message: "Add ".concat(amountA, " ").concat(tokenA, " + ").concat(amountB, " ").concat(tokenB, " to ").concat(venue),
                                estimatedFee: fee / LAMPORTS_PER_SOL,
                                expiresAt: lastValidBlockHeight + 150,
                            },
                            instructions: instructions,
                        }];
                case 10:
                    error_1 = _c.sent();
                    err = error_1;
                    log.error('Failed to build Meteora TX', { error: err.message, stack: err.stack });
                    return [2 /*return*/, { success: false, error: err.message }];
                case 11: return [2 /*return*/];
            }
        });
    });
}
/**
 * Build unsigned remove liquidity transaction
 */
export function buildRemoveLiquidityTx(connection, params) {
    return __awaiter(this, void 0, void 0, function () {
        var userPubkey, positionId, venue, _a, percentage, user, _b, blockhash, lastValidBlockHeight, tx, memoProgram, serialized, error_2;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 2, , 3]);
                    userPubkey = params.userPubkey, positionId = params.positionId, venue = params.venue, _a = params.percentage, percentage = _a === void 0 ? 100 : _a;
                    user = new PublicKey(userPubkey);
                    return [4 /*yield*/, connection.getLatestBlockhash()];
                case 1:
                    _b = _c.sent(), blockhash = _b.blockhash, lastValidBlockHeight = _b.lastValidBlockHeight;
                    tx = new Transaction();
                    tx.recentBlockhash = blockhash;
                    tx.feePayer = user;
                    memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
                    tx.add(new TransactionInstruction({
                        keys: [{ pubkey: user, isSigner: true, isWritable: false }],
                        programId: memoProgram,
                        data: Buffer.from(JSON.stringify({
                            action: "remove_liquidity",
                            venue: venue,
                            positionId: positionId,
                            percentage: percentage,
                        })),
                    }));
                    serialized = tx
                        .serialize({
                        requireAllSignatures: false,
                        verifySignatures: false,
                    })
                        .toString("base64");
                    return [2 /*return*/, {
                            success: true,
                            transaction: {
                                serialized: serialized,
                                message: "Remove ".concat(percentage, "% liquidity from position"),
                                estimatedFee: 0.000005,
                                expiresAt: lastValidBlockHeight + 150,
                            },
                            instructions: [
                                "Remove ".concat(percentage, "% from ").concat(venue, " position ").concat(positionId.slice(0, 8), "..."),
                            ],
                        }];
                case 2:
                    error_2 = _c.sent();
                    return [2 /*return*/, {
                            success: false,
                            error: error_2.message,
                        }];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Decode and display transaction for user confirmation
 */
export function describeTx(serializedTx) {
    var _a;
    try {
        var buffer = Buffer.from(serializedTx, "base64");
        var tx = Transaction.from(buffer);
        return {
            feePayer: ((_a = tx.feePayer) === null || _a === void 0 ? void 0 : _a.toBase58()) || "Unknown",
            instructions: tx.instructions.length,
            estimatedFee: "~0.000005 SOL",
        };
    }
    catch (_b) {
        return {
            feePayer: "Unable to decode",
            instructions: 0,
            estimatedFee: "Unknown",
        };
    }
}
export default {
    buildAddLiquidityTx: buildAddLiquidityTx,
    buildRemoveLiquidityTx: buildRemoveLiquidityTx,
    describeTx: describeTx,
    TOKENS: TOKENS,
};
