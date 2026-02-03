import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { useMfaEnrollment, usePrivy } from "@privy-io/react-auth";
import MfaImage from "~/assets/mfa.png";
import { useMfaReminderStore } from "~/states/mfa";
import { Button } from "./ui/Button";
import { MnMSuspense } from "./MnMSuspense";
import Backdrop from "./ui/Backdrop";
import { useDisableBackgroundScroll } from "~/hooks/useDisableBackgroundScroll";

export function MfaReminderModal() {
  const { user } = usePrivy();
  const { showMfaEnrollmentModal, closeMfaEnrollmentModal } =
    useMfaEnrollment();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const isOpen = useMfaReminderStore((s) => s.isOpen);
  const close = useMfaReminderStore((s) => s.close);

  useDisableBackgroundScroll(isOpen);

  const hasMfa = Boolean(user?.mfaMethods?.length);

  useEffect(() => {
    if (!isOpen) setShowConfirmation(false);
    if (hasMfa && isOpen) {
      close();
      setShowConfirmation(false);
      closeMfaEnrollmentModal();
    }
  }, [hasMfa, isOpen, close]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <Backdrop onClick={() => {}} show />

        {/* Modal */}
        <MnMSuspense fallback={null}>
          <motion.div
            layout
            className="relative p-3 z-40 bg-white/2 backdrop-blur-3xl inner-white rounded-3xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: "spring", damping: 15, stiffness: 150 }}
          >
            <div className="w-[650px]">
              {/* Header Image */}
              <div className="relative w-full h-44 mb-3 overflow-hidden rounded-2xl">
                <AnimatePresence mode="wait">
                  {!showConfirmation ? (
                    <div className="relative w-full h-44 mb-3 overflow-hidden rounded-2xl">
                      <motion.img
                        key="image"
                        src={MfaImage}
                        draggable={false}
                        className="absolute inset-0 w-full h-full object-cover select-none rounded-2xl"
                        exit={{ opacity: 0 }}
                        style={{ willChange: "transform" }}
                      />

                      <div className="absolute inset-0 bg-black/40" />
                    </div>
                  ) : (
                    <motion.div
                      key="alert"
                      className="absolute inset-0 bg-red/20 rounded-2xl flex justify-center items-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <AlertTriangle className="w-[72px] h-[72px] text-red" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Title */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={showConfirmation ? "confirm-title" : "intro-title"}
                  className="text-[16px] text-white pb-1"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  {showConfirmation
                    ? "Are you sure you want to skip MFA setup?"
                    : "Enable Multi-Factor Authentication (MFA)"}
                </motion.p>
              </AnimatePresence>

              {/* Description */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={showConfirmation ? "confirm-desc" : "intro-desc"}
                  className="text-xs text-white/40 pb-6 max-w-[99%]"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                >
                  {showConfirmation
                    ? "Without MFA, you won’t be able to export your keys or use MnM’s advanced automation features in the future — and your wallet will be more exposed to unauthorized access."
                    : "Multi-Factor Authentication (MFA) adds an extra layer of protection to your MnM wallet. It ensures that even if someone gains access to your device or login method, they won’t be able to control your account or private keys without your approval."}
                </motion.p>
              </AnimatePresence>

              {/* Buttons */}
              <div className="w-full flex gap-2 justify-end mb-2">
                {!showConfirmation ? (
                  <>
                    <Button
                      variant="neutral"
                      className="py-1.5 px-3 rounded-lg text-xs"
                      onClick={() => setShowConfirmation(true)}
                    >
                      Skip
                    </Button>

                    <Button
                      variant="neutral"
                      className="bg-primary/20 border border-primary/20 text-primary py-1.5 px-4 rounded-lg text-xs hover:bg-primary/30 "
                      onClick={showMfaEnrollmentModal}
                    >
                      Set Up MFA (Recommended)
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="neutral"
                      className="py-1.5 px-3 rounded-lg text-xs"
                      onClick={showMfaEnrollmentModal}
                    >
                      No, Set Up MFA
                    </Button>

                    <Button
                      variant="danger"
                      className="py-1.5 px-3 rounded-lg text-xs"
                      onClick={close}
                    >
                      Yes, don’t protect my wallet
                    </Button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </MnMSuspense>
      </div>
    </AnimatePresence>
  );
}
