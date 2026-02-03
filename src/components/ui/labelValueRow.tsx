import { ReactNode } from "react";
import { cn } from "~/utils/cn";
import { Skeleton } from "./Skeleton";

type Variant = "row" | "inline";

interface LabelValueProps {
  label: ReactNode;
  value: ReactNode;
  variant?: Variant;
  isLoading?: boolean;
  labelClassName?: string;
  valueClassName?: string;
  className?: string;
}

export function LabelValue({
  label,
  value,
  variant = "inline",
  isLoading = false,
  labelClassName,
  valueClassName,
  className,
}: LabelValueProps) {
  const isRow = variant === "row";

  return (
    <div
      className={cn(
        "flex items-center",
        isRow ? "justify-between w-full" : "gap-0.5",
        className,
      )}
    >
      <div
        className={cn(
          isRow ? "text-sm text-textSecondary" : "text-sm text-textSecondary",
          labelClassName,
        )}
      >
        {label}
      </div>

      <div
        className={cn(
          isRow ? "text-xs text-text" : "text-sm text-text",
          "truncate",
          valueClassName,
        )}
      >
        {isLoading ? (
          <Skeleton className={cn("w-12 h-4 rounded-md", valueClassName)} />
        ) : (
          value
        )}
      </div>
    </div>
  );
}
