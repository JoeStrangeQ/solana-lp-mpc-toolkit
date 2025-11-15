import { motion } from "framer-motion";
import { cn } from "~/utils/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "ghost" | "neutral" | "liquidPrimary" | "liquidWhite";

export interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary/85 hover:bg-primary text-white",
  liquidPrimary: "bg-primary/10 hover:bg-primary/20 inner-primary text-primary",
  liquidWhite: "bg-backgroundSecondary/40 hover:bg-white/5 inner-white text-text",
  ghost: "bg-transparent hover:bg-white/5 text-text",
  neutral: "bg-white/10 hover:bg-white/15 text-text",
};

export function Button({ children, onClick, variant = "primary", loading, disabled, className }: ButtonProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onClick={!disabled ? onClick : undefined}
      className={cn(
        "flex items-center justify-center py-3 px-4 h-min rounded-full cursor-pointer select-none whitespace-nowrap font-semibold gap-2 hover-effect active:scale-95",
        variants[variant],
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </motion.div>
  );
}
