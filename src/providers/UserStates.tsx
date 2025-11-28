import { create } from "zustand";
import { Doc } from "../../convex/_generated/dataModel";
import { Address, toAddress } from "../../convex/utils/solana";

type ConvexUserLocal = Omit<Doc<"users">, "address"> & { address: Address };

export const useConvexUser = create<{
  convexUser: ConvexUserLocal | null;
  signout: () => void;
  signIn: (user: Doc<"users">) => void;
}>((set) => ({
  convexUser: null,

  signout: () => set({ convexUser: null }),

  signIn: (user: Doc<"users">) =>
    set({
      convexUser: {
        ...user,
        address: toAddress(user.address),
      },
    }),
}));
