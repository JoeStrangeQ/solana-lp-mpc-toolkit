import { Coins } from "lucide-react";
import { cn } from "~/utils/cn";
import { MeteoraIcon } from "./icons/MeteoraIcon";
import { Skeleton } from "./ui/Skeleton";

interface TokenIconProps {
  logoURI?: string | null;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
}

export function TokenIcon({ logoURI, style, className = "h-7 w-7" }: TokenIconProps) {
  return logoURI && logoURI !== "" ? (
    <img
      src={logoURI}
      draggable={false}
      className={`rounded-full select-none object-cover ${className}`}
      style={style}
    />
  ) : (
    <div
      className={`flex items-center select-none justify-center rounded-full bg-backgroundSecondary border border-white/10 ${className} p-1.5`}
      style={style}
    >
      <Coins className="w-full h-full text-text" />
    </div>
  );
}

export function PoolTokenIcons({
  xIcon,
  yIcon,
  size,
  dex,
  className,
  isLoading = false,
}: {
  xIcon?: string | null;
  yIcon?: string | null;
  dex?: "Meteora" | "Orca";
  size: number;
  className?: string;
  isLoading?: boolean;
}) {
  const spaceX = size / 2.5;
  const dexIconSize = size * 0.35;

  return (
    <div
      className={cn("relative flex items-center", className)}
      style={
        {
          "--s": `${size}px`,
          "--sLoad": `${size * 2 - spaceX}px`,
          "--space": `-${spaceX}px`,
          "--dex": `${dexIconSize}px`,
        } as React.CSSProperties
      }
    >
      {isLoading ? (
        <Skeleton className="w-(--sLoad) h-(--s) rounded-full" />
      ) : (
        <div className="flex items-center">
          <TokenIcon logoURI={xIcon} className="w-(--s) h-(--s) z-1" />
          <TokenIcon logoURI={yIcon} className="w-(--s) h-(--s) z-0" style={{ marginLeft: "var(--space)" }} />
        </div>
      )}

      {/* Optional dex icon or its skeleton */}
      {!isLoading &&
        (dex === "Meteora" ? (
          <div className="absolute -bottom-0.5 -right-0.5 p-1 rounded-full bg-background">
            <MeteoraIcon className="w-(--dex) h-(--dex)" />
          </div>
        ) : (
          <></>
        ))}
    </div>
  );
}
