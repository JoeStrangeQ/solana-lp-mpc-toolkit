import { usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const MFA_REMINDER_COOLDOWN_MS = 4 * 60 * 60 * 1000; //  4 hours
interface MfaReminderState {
  isOpen: boolean;
  lastShownAt: number | null;

  shouldShow: () => boolean;
  open: () => void;
  close: () => void;
  markShown: () => void;
}

export const useMfaReminderStore = create<MfaReminderState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      lastShownAt: null,

      shouldShow: () => {
        const last = get().lastShownAt;
        if (!last) return true;
        return Date.now() - last > MFA_REMINDER_COOLDOWN_MS;
      },

      open: () => set({ isOpen: true }),

      close: () =>
        set({
          isOpen: false,
          lastShownAt: Date.now(),
        }),

      markShown: () =>
        set({
          isOpen: true,
          lastShownAt: Date.now(),
        }),
    }),
    {
      name: "mnm-mfa-reminder",

      // ✅ THIS IS THE MAGIC
      partialize: (state) => ({
        lastShownAt: state.lastShownAt,
      }),
    },
  ),
);

export function useMfaReminderGuard() {
  const { user, ready, authenticated } = usePrivy();

  const shouldShow = useMfaReminderStore((s) => s.shouldShow);
  const markShown = useMfaReminderStore((s) => s.markShown);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;

    const hasMfa = user.mfaMethods && user.mfaMethods.length > 0;

    if (!hasMfa && shouldShow()) {
      markShown();
    }
  }, [ready, authenticated, user]);
}
