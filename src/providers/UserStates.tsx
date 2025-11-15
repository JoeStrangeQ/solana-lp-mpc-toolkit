import { Doc } from 'convex/_generated/dataModel'
import { create } from 'zustand'

export const useConvexUser = create<{
  convexUser: Doc<'users'> | null
  signout: () => void
  signIn: (user: Doc<'users'>) => void
}>((set) => ({
  convexUser: null,
  signout: () => set({ convexUser: null }),
  signIn: (user: Doc<'users'>) => set({ convexUser: user }),
}))
