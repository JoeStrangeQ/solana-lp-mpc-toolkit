import { Address, toAddress } from "../utils/solana";
import { vLiquidityShape } from "../schema/positions";
import { Infer } from "convex/values";
import z from "zod";
import { vLoopscaleQuote } from "../actions/dlmmPosition/createPosition";

export const LOOPSCALE_BASE_URL = "https://case.loopscale.com/v1";
export const LOOPSCALE_PROGRAM_ID = "sboXjDPocEasbTKokLUiNb1NrnikbBBZCooXKrjZkZd";

type flashBorrowReq = {
  depositMint: Address;
  depositCollateral: DepositCollateral[];
  principalRequested: PrincipalRequested[];
  cpiIxs: LoopscaleIx[];
  setupIxs: LoopscaleIx[];
  unifySetup: boolean;
};

export type LoopscaleIx = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; //base 64 or hex-encoded
};
type DepositCollateral = {
  collateralAmount: number;
  collateralAssetData: {
    Meteora: {
      positionAddress: Address;
      lbPair: Address;
    };
  };
  loanCreationParams: {
    MeteoraDlmmPositionCreate: MeteoraDlmmPositionCreate;
  };
};

type MeteoraDlmmPositionCreate = {
  minBinId: number;
  width: number;
  liquidityParameter: LiquidityParameter;
};

type LiquidityParameter = {
  amountX: number;
  amountY: number;
  activeId: number;
  maxActiveBinSlippage: number;
  strategyParameters: StrategyParameters;
};

type StrategyParameters = {
  minBinId: number;
  maxBinId: number;
  strategyType: StrategyType;
  parameteres: number[]; // 64-element array buffer
};

enum StrategyType {
  SpotBalanced = "spotBalanced",
  CurveBalanced = "curveBalanced",
  BidAskBalanced = "bidAskBalanced",
  SpotImBalanced = "spotImBalanced",
  CurveImBalanced = "curveImBalanced",
  BidAskImBalanced = "bidAskImBalanced",
  SpotOneSide = "spotOneSide",
  CurveOneSide = "curveOneSide",
  BidAskOneSide = "bidAskOneSide",
}

type PrincipalRequested = {
  ledgerIndex: number;
  durationIndex: number;
  principalAmount: number;
  principalMint: Address;
  strategy: Address;
  expectedLoanValues: {
    expectedApy: number;
    expectedLqt: number[];
  };
};

const TransactionSignatureZ = z.object({
  publicKey: z.string(),
  signature: z.string(),
});

const TransactionZ = z.object({
  message: z.string(), // base64 encoded transaction
  signatures: z.array(TransactionSignatureZ),
});

const LoopscaleFlashBorrowResponseZ = z.object({
  transactions: z.array(TransactionZ),
  loanAddress: z.string(),
});

type LoopscaleFlashBorrowResponse = z.infer<typeof LoopscaleFlashBorrowResponseZ>;

// -------------------- Repay types --------------------
type RepayParam = {
  amount: number;
  ledgerIndex: number;
  repayAll: boolean;
};

type CollateralWithdrawalParam = {
  amount: number;
  collateralMint: Address;
};

type RepayReq = {
  loan: Address;
  repayParams: RepayParam[];
  collateralWithdrawalParams?: CollateralWithdrawalParam[];
  cpiIxs?: LoopscaleIx[];
  unifySetup?: boolean;
};

const LoopscaleRepayResponseZ = z.object({
  transactions: z.array(TransactionZ),
  loanAddress: z.string().optional(),
});

type LoopscaleRepayResponse = z.infer<typeof LoopscaleRepayResponseZ>;

export async function flashBorrow({
  userAddress,
  positionPda,
  collateralMint,
  collateralBorrowedRawAmount,
  xRawAmount,
  yRawAmount,
  activeBinId,
  lowerBinId,
  upperBinId,
  liquidityShape,
  poolAddress,
  borrowQuote,
  setupIxs = [],
}: {
  userAddress: Address;
  collateralMint: Address;
  collateralBorrowedRawAmount: number;
  positionPda: Address;
  xRawAmount: number;
  yRawAmount: number;
  poolAddress: Address;
  lowerBinId: number;
  activeBinId: number;
  upperBinId: number;
  liquidityShape: Infer<typeof vLiquidityShape>;
  setupIxs?: LoopscaleIx[];
  borrowQuote: Infer<typeof vLoopscaleQuote>;
}): Promise<LoopscaleFlashBorrowResponse> {
  const principalRequested: PrincipalRequested[] = [
    {
      ledgerIndex: 0,
      durationIndex: 0,
      principalAmount: collateralBorrowedRawAmount,
      principalMint: collateralMint,
      strategy: toAddress(borrowQuote.strategy),
      expectedLoanValues: {
        expectedApy: borrowQuote.cBpsApy,
        expectedLqt: [borrowQuote.cBpsLqt, 0, 0, 0, 0],
      },
    },
  ];

  const depositCollateral: DepositCollateral[] = [
    {
      collateralAmount: 1,
      collateralAssetData: {
        Meteora: { lbPair: poolAddress, positionAddress: positionPda },
      },
      loanCreationParams: {
        MeteoraDlmmPositionCreate: {
          minBinId: lowerBinId,
          width: upperBinId - lowerBinId + 1,
          liquidityParameter: {
            amountX: xRawAmount,
            amountY: yRawAmount,
            maxActiveBinSlippage: 250,
            activeId: activeBinId,
            strategyParameters: {
              minBinId: lowerBinId,
              maxBinId: upperBinId,
              strategyType: toStrategyType({ liquidityShape, xRawAmount, yRawAmount }),
              parameteres: new Array(64).fill(0),
            },
          },
        },
      },
    },
  ];

  const requestBody: flashBorrowReq = {
    depositMint: collateralMint,
    unifySetup: true,
    principalRequested,
    depositCollateral,
    setupIxs,
    cpiIxs: [],
  };

  console.log("flashBorrow request (object)", requestBody);
  console.log("wallet address...:", userAddress);
  console.log("req", JSON.stringify(requestBody));
  const response = await fetch(`${LOOPSCALE_BASE_URL}/markets/creditbook/flash_borrow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-wallet": userAddress,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Loopscale flash_borrow API error: ${response.status}: ${errorText}`);
  }

  const responseData = await response.json();
  console.log("loopscale flash borrow response", responseData);
  return LoopscaleFlashBorrowResponseZ.parse(responseData);
}

// Repay an existing Loopscale loan (no wiring to actions/UI yet)
export async function repayLoan({
  userAddress,
  loanAddress,
  repayParams,
  collateralWithdrawalParams,
  cpiIxs = [],
  unifySetup = false,
}: {
  userAddress: Address;
  loanAddress: Address;
  repayParams: RepayParam[];
  collateralWithdrawalParams: CollateralWithdrawalParam[];
  cpiIxs?: LoopscaleIx[];
  unifySetup?: boolean;
}): Promise<LoopscaleRepayResponse> {
  if (!repayParams.length) {
    throw new Error("repayParams must contain at least one entry");
  }

  const requestBody: RepayReq = {
    loan: loanAddress,
    repayParams,
    collateralWithdrawalParams: collateralWithdrawalParams.length ? collateralWithdrawalParams : undefined,
    cpiIxs: cpiIxs.length ? cpiIxs : [],
    unifySetup: unifySetup || undefined,
  };

  console.log("repayLoan request (object)", requestBody);
  console.log("wallet address...:", userAddress);
  console.log("repay req", JSON.stringify(requestBody));

  const response = await fetch(`${LOOPSCALE_BASE_URL}/markets/creditbook/repay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-wallet": userAddress,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Loopscale repay API error: ${response.status}: ${errorText}`);
  }

  const responseData = await response.json();
  return LoopscaleRepayResponseZ.parse(responseData);
}

export function toStrategyType({
  liquidityShape,
  xRawAmount,
  yRawAmount,
}: {
  liquidityShape: "Spot" | "Curve" | "BidAsk";
  xRawAmount: number;
  yRawAmount: number;
}): StrategyType {
  const isOneSide = xRawAmount === 0 || yRawAmount === 0;
  const isBalanced = xRawAmount === yRawAmount;

  switch (liquidityShape) {
    case "Spot":
      if (isOneSide) return StrategyType.SpotImBalanced;
      if (isBalanced) return StrategyType.SpotBalanced;
      return StrategyType.SpotImBalanced;

    case "Curve":
      if (isOneSide) return StrategyType.CurveImBalanced;
      if (isBalanced) return StrategyType.CurveBalanced;
      return StrategyType.CurveImBalanced;

    case "BidAsk":
      if (isOneSide) return StrategyType.BidAskImBalanced;
      if (isBalanced) return StrategyType.BidAskBalanced;
      return StrategyType.BidAskImBalanced;

    default:
      throw new Error("Unknown liquidity shape: " + liquidityShape);
  }
}
