import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Address, toAddress, zAddress } from "../../convex/utils/solana";

export type Protocol = "dlmm" | "damm" | "clmm";

export interface LastVisitedState {
  lastVisited: string | null;

  lastByProtocol: {
    dlmm: string | null;
    damm: string | null;
    clmm: string | null;
  };

  // dynamic dictionary: "sol-usdc" → { protocol, poolAddress }
  lastByPairKey: Record<
    string,
    { protocol: Protocol; poolAddress: Address } | null
  >;

  // MAIN API:
  setLastVisited: ({
    poolAddress,
    protocol,
  }: {
    protocol: Protocol;
    poolAddress: string;
  }) => void;
  getLastVisited: () => string | null;

  setLastByPairKey: ({
    pairKey,
    poolAddress,
    protocol,
  }: {
    pairKey: string;
    protocol: Protocol;
    poolAddress: Address;
  }) => void;

  getLastByPairKey: (
    pairKey: string,
  ) => { protocol: Protocol; poolAddress: Address } | null | undefined;
}

export const useLastVisitedPool = create(
  persist<LastVisitedState>(
    (set, get) => ({
      lastVisited: null,

      lastByProtocol: {
        dlmm: null,
        damm: null,
        clmm: null,
      },

      lastByPairKey: {
        "sol-usdc": {
          protocol: "dlmm",
          poolAddress: toAddress("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6"),
        },
        "met-usdc": {
          protocol: "dlmm",
          poolAddress: toAddress(
            "5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd",
          ),
        },
        "met-sol": {
          protocol: "dlmm",
          poolAddress: toAddress(
            "AsSyvUnbfaZJPRrNh3kUuvZTeHKoMVWEoHz86f4Q5D9x",
          ),
        },
      },

      setLastVisited: ({ protocol, poolAddress }) => {
        const isValid = zAddress.safeParse(poolAddress).success;
        if (!isValid) return;

        set((state) => ({
          lastVisited: `/${protocol}/${poolAddress}`,
          lastByProtocol: {
            ...state.lastByProtocol,
            [protocol]: poolAddress,
          },
        }));
      },

      getLastVisited: () => get().lastVisited,

      setLastByPairKey: ({ pairKey, protocol, poolAddress }) => {
        const key = pairKey.toLowerCase();
        const isValid = zAddress.safeParse(poolAddress).success;
        if (!isValid) return;

        set((state) => ({
          lastByPairKey: {
            ...state.lastByPairKey,
            [key]: { protocol, poolAddress },
          },
        }));
      },

      getLastByPairKey: (pairKey) => {
        const key = pairKey.toLowerCase();
        return get().lastByPairKey[key];
      },
    }),
    {
      name: "mnm-last-visited-pool",
    },
  ),
);
