import { cn } from "~/utils/cn";

export type fontSizes =
  | "text-xs"
  | "text-sm"
  | "text-base"
  | "text-lg"
  | "text-xl"
  | "text-2xl"
  | "text-3xl"
  | "text-4xl";
export function FormattedBinPrice({
  value,
  significantDigits = 4,
  classname,
}: {
  value: number;
  significantDigits?: number;
  classname?: string;
}) {
  // Only use scientific formatting if value is really small (< 0.001)
  if (value === 0 || Math.abs(value) >= 0.001) {
    return (
      <span className={cn("text-white", classname)}>
        {value.toFixed(significantDigits)}
      </span>
    );
  }

  // For very small numbers, use scientific notation
  const str = value.toExponential();
  const match = str.match(/^([0-9.]+)e-(\d+)$/);

  if (!match) {
    return (
      <span className={cn("text-white", classname)}>
        {value.toFixed(significantDigits)}
      </span>
    );
  }

  const [, base, expStr] = match;
  const exp = parseInt(expStr, 10);
  const digits = base.replace(".", "").slice(0, significantDigits);

  return (
    <span className={cn("text-white", classname)}>
      0.0
      <sub className="text-[10px] text-white/40">{exp - 1}</sub>
      {digits}
    </span>
  );
}
