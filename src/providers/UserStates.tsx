import { create } from "zustand";
import { Doc } from "../../convex/_generated/dataModel";

export const useConvexUser = create<{
  convexUser: Doc<"users"> | null;
  signout: () => void;
  signIn: (user: Doc<"users">) => void;
}>((set) => ({
  convexUser: null,
  signout: () => set({ convexUser: null }),
  signIn: (user: Doc<"users">) => set({ convexUser: user }),
}));
