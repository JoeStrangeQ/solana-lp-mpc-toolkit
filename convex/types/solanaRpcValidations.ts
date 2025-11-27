import z from "zod";

const zRpcTokenAmount = z.object({
  amount: z.string(),
  decimals: z.number(),
  uiAmount: z.number().nullable(),
  uiAmountString: z.string().optional(),
});
const zRpcTokenBalanceSchema = z.object({
  accountIndex: z.number(),
  mint: z.string(),
  owner: z.string().optional(),
  programId: z.string().optional(),
  uiTokenAmount: zRpcTokenAmount,
});

export const zSimulationValueSchema = z.object({
  accounts: z.any().nullable(),
  err: z.any().nullable(),
  fee: z.any().nullable(),
  innerInstructions: z.array(z.any()).nullable(),
  loadedAccountsDataSize: z.number().nullable(),
  loadedAddresses: z.object({
    readonly: z.array(z.string()),
    writable: z.array(z.string()),
  }),
  logs: z.array(z.string()).nullable(),
  postBalances: z.array(z.number()),
  postTokenBalances: z.array(zRpcTokenBalanceSchema),
  preBalances: z.array(z.number()),
  preTokenBalances: z.array(zRpcTokenBalanceSchema),
  replacementBlockhash: z
    .object({
      blockhash: z.string(),
      lastValidBlockHeight: z.number(),
    })
    .nullable(),
  returnData: z
    .object({
      programId: z.string(),
      data: z.array(z.string()),
    })
    .nullable(),
  unitsConsumed: z.number(),
});

export const zSimulationResultSchema = z.object({
  jsonrpc: z.string(),
  result: z.object({
    context: z.object({
      apiVersion: z.string(),
      slot: z.number(),
    }),
    value: zSimulationValueSchema,
  }),
});

export type RpcTokenAmount = z.infer<typeof zRpcTokenAmount>;
export type SimulationValue = z.infer<typeof zSimulationValueSchema>;
