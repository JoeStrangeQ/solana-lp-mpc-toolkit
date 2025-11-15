import { motion } from "motion/react";
import { SVGProps } from "react";
import { cn } from "~/utils/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{
        duration: 0.4,
        repeat: Infinity,
        ease: "linear",
      }}
      className={cn("inline-block", className)}
    >
      <SpinnerIcon className="w-full h-full" />
    </motion.div>
  );
}

function SpinnerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="7.5" cy="7.5" r="6.5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
      <path d="M1 7.5C1 3.91015 3.91015 1 7.5 1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
