import { motion } from "framer-motion";
import { cn } from "~/utils/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "ghost"
  | "neutral"
  | "liquidPrimary"
  | "liquidWhite"
  | "danger"
  | "liquidDanger";

export interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary/85 text-white",
  liquidPrimary: "bg-primary/10 inner-primary text-primary",
  liquidWhite: "bg-backgroundSecondary/40 inner-white text-text",
  ghost: "bg-transparent text-text",
  neutral: "bg-white/10 text-text",
  danger: "bg-red/10 border-1 border-red/20 text-red",
  liquidDanger: "bg-red/10 inner-red text-red",
};

const variantsHover: Record<ButtonVariant, string> = {
  primary: "hover:bg-primary",
  liquidPrimary: "hover:bg-primary/15",
  liquidWhite: "hover:bg-white/5",
  ghost: "hover:bg-white/5",
  neutral: "hover:bg-white/15",
  danger: "hover:bg-red/15",
  liquidDanger: "hover:bg-red/15",
};

export function Button({ children, onClick, variant = "primary", loading, disabled, className }: ButtonProps) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: disabled ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center py-3 px-4  h-min rounded-full select-none whitespace-nowrap font-semibold gap-2",
        variants[variant],
        disabled ? "opacity-20" : `cursor-pointer hover-effect active:scale-95 ${variantsHover[variant]}`,
        className
      )}
      disabled={disabled}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </motion.button>
  );
}
