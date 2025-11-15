import { HTMLAttributes, ReactNode } from "react";
import { cn } from "~/utils/cn";

type RowProps = {
  children: ReactNode;
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
} & HTMLAttributes<HTMLDivElement>;

export function Row({ children, className, justify = "between", ...rest }: RowProps) {
  return (
    <div className={cn("flex flex-row items-center w-full", `justify-${justify}`, className)} {...rest}>
      {children}
    </div>
  );
}
