import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";

const SPRING = {
  type: "spring" as const,
  damping: 20,
  mass: 1,
  stiffness: 160,
};

export function Ticker({
  value,
  className,
  animateOnMount = true,
}: {
  value: string;
  className?: string;
  animateOnMount?: boolean;
}) {
  const decimalsSeparatorIndex = value.indexOf(".");
  const chars = value.split("");

  const fadeVariants = useMemo(
    () => ({
      fadeInDown: {
        initial: { opacity: 0, translateY: 6 },
        animate: { opacity: 1, translateY: 0 },
        exit: { opacity: 0, translateY: 6 },
      },
      fadeOutUp: {
        initial: { opacity: 1 },
        animate: { opacity: 0, translateY: 6, scale: 0.5 },
      },
      fadeOutDecimals: {
        initial: { opacity: 1 },
        animate: { opacity: 0 },
      },
    }),
    []
  );

  return (
    <div className="flex flex-row">
      <AnimatePresence>
        {chars.map((char, i) => {
          const isWholeNumber = i < decimalsSeparatorIndex || decimalsSeparatorIndex === -1;
          return (
            <motion.div
              key={i}
              className={`${isWholeNumber ? "text-text" : "text-textSecondary"} font-bold select-none
 ${className ?? ""}`}
              initial={animateOnMount ? fadeVariants.fadeInDown.initial : undefined}
              animate={fadeVariants.fadeInDown.animate}
              exit={isWholeNumber ? fadeVariants.fadeOutUp.animate : fadeVariants.fadeOutDecimals.animate}
              transition={
                isWholeNumber
                  ? {
                      ...SPRING,
                      delay: 0.04 * i,
                    }
                  : { duration: 0.1 }
              }
            >
              {char}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
