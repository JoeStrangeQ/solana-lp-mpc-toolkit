import { Coins } from "lucide-react";

interface TokenIconProps {
  logoURI?: string | null;
  className?: string;
  alt?: string;
}

export function TokenIcon({ logoURI, className = "h-7 w-7" }: TokenIconProps) {
  return logoURI && logoURI !== "" ? (
    <img src={logoURI} draggable={false} className={`rounded-full select-none object-cover ${className}`} />
  ) : (
    <div
      className={`flex items-center select-none justify-center rounded-full bg-backgroundSecondary border border-white/10 ${className} p-1.5`}
    >
      <Coins className="w-full h-full text-text" />
    </div>
  );
}
