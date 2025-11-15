import { ReactNode } from "react";
import { cn } from "~/utils/cn";
import { Skeleton } from "./Skeleton";

export function LabelValueRow({
  label,
  value,

  isLoading = false,
  labelClassName,
  valueClassName,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  isLoading?: boolean;
  labelClassName?: string;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full",
        "flex flex-row items-center justify-between",

        className
      )}
    >
      <div className={cn("text-sm text-textSecondary truncate", labelClassName)}>{label}</div>
      <div className={cn("text-xs text-text truncate", valueClassName)}>
        {isLoading ? <Skeleton className="w-12 h-4 rounded-md" /> : value}
      </div>
    </div>
  );
}
