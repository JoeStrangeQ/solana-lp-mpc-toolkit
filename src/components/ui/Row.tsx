import { HTMLAttributes, ReactNode } from "react";
import { cn } from "~/utils/cn";

type RowProps = {
  children: ReactNode;
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  fullWidth?: boolean;
} & HTMLAttributes<HTMLDivElement>;

const justifyMap = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
} as const;

export function Row({ children, className, justify = "between", fullWidth = false, ...rest }: RowProps) {
  return (
    <div className={cn("flex flex-row items-center", fullWidth && "w-full", justifyMap[justify], className)} {...rest}>
      {children}
    </div>
  );
}
