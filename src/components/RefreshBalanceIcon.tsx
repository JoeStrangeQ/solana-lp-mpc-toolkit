import { RotateCw } from "lucide-react";
import { MnMSuspense } from "./MnMSuspense";
import { cn } from "~/utils/cn";
import { useBalances } from "~/states/balances";
import { toAddress } from "../../convex/utils/solana";

export function RefreshTokenBalancesIcon({
  userAddress,
  size = "sm",
  className,
}: {
  userAddress: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <MnMSuspense
      fallback={
        <RefreshBalanceIconPlaceholder size={size} className={className} />
      }
    >
      <RefreshBalance
        userAddress={userAddress}
        size={size}
        className={className}
      />
    </MnMSuspense>
  );
}

function RefreshBalance({
  userAddress,
  size = "sm",
  className,
}: {
  userAddress: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { refetch, isFetching } = useBalances({
    address: toAddress(userAddress),
  });

  // map size → tailwind classes
  const sizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-5 h-5",
    lg: "w-7 h-7",
  }[size];

  return (
    <button
      onClick={() => refetch()}
      disabled={isFetching}
      className={cn(
        "group flex items-center justify-center cursor-pointer disabled:cursor-not-allowed",
        "hover:text-text/80 transition-colors",
        className,
      )}
    >
      <RotateCw
        className={cn(
          sizeClasses,
          "text-textSecondary transition-transform duration-200",
          isFetching
            ? "animate-spin"
            : "group-hover:rotate-[-15deg] group-hover:scale-110",
        )}
      />
    </button>
  );
}

function RefreshBalanceIconPlaceholder({
  size = "sm",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-5 h-5",
    lg: "w-7 h-7",
  }[size];

  return (
    <RotateCw className={cn(sizeClasses, "text-textSecondary", className)} />
  );
}
