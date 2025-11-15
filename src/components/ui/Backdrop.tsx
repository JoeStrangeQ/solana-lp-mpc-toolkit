import { AnimatePresence, motion } from "motion/react";
import { cn } from "~/utils/cn";

export default function Backdrop({
  show,
  onClick,
  className,
}: {
  show: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={cn("fixed inset-0 bg-black/40 z-10 flex items-center justify-center backdrop-blur-sm", className)}
          onClick={onClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        />
      )}
    </AnimatePresence>
  );
}
