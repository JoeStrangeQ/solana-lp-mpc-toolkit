import { AnimatePresence, motion } from "motion/react";
import { Row } from "./Row";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "~/utils/cn";
import { ReactNode } from "react";
import { MnMSuspense } from "../MnMSuspense";

export function Modal({
  title,
  main,
  show,
  onClose,
  className,
}: {
  title: ReactNode | string;
  main: ReactNode;
  show: boolean;
  onClose: () => void;
  className?: string;
}) {
  return createPortal(
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Smooth animated backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />

          {/* Modal card */}
          <MnMSuspense fallback={<></>}>
            <motion.div
              layout
              className={cn("relative py-6 px-5 z-40 bg-white/5 backdrop-blur-xl inner-white rounded-4xl", className)}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{
                type: "spring",
                damping: 15,
                stiffness: 150,
              }}
            >
              {/* Header row */}
              <Row className="gap-5">
                <motion.div
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1, duration: 0.4, ease: "easeOut" }}
                  className="w-full"
                >
                  {typeof title === "string" ? <div className="text-text text-left text-xl">{title}</div> : title}
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1, duration: 0.4, ease: "easeOut" }}
                  className="bg-white/5 p-2 rounded-full transition-colors duration-200 hover:bg-white/10 cursor-pointer"
                  onClick={onClose}
                >
                  <X className="w-4 h-4 text-text" />
                </motion.div>
              </Row>

              {/* Main content */}
              <motion.div
                className="mt-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.3,
                  duration: 0.4,
                  ease: "easeOut",
                }}
              >
                {main}
              </motion.div>
            </motion.div>
          </MnMSuspense>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
