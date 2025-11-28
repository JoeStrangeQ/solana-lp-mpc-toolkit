export function tokenAmountFormatter(options?: { maximumFractionDigits: number; minimumFractionDigits?: number }) {
  // Clamp to valid Intl range (0..20)
  const max = Math.min(Math.max(options?.maximumFractionDigits ?? 5, 0), 20);
  const min = Math.min(Math.max(options?.minimumFractionDigits ?? 0, 0), max);

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: max,
    minimumFractionDigits: min,
    notation: "standard",
    style: "decimal",
  });
}

export function formatUsdValue(
  value: number,
  options?: {
    renderCurrency?: boolean;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }
) {
  return formatFiatValue(value, {
    minimumFractionDigits: options?.minimumFractionDigits,
    maximumFractionDigits: options?.maximumFractionDigits,
    renderCurrency: options?.renderCurrency ?? true,
  });
}

export function formatFiatValue(
  value: number,
  options?: {
    renderCurrency?: boolean;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }
) {
  const renderCurrency = options?.renderCurrency ?? true;

  const clampedMin = Math.min(Math.max(options?.minimumFractionDigits ?? 0, 0), 20);
  const clampedMax = Math.min(Math.max(options?.maximumFractionDigits ?? Math.max(2, clampedMin), clampedMin), 20);

  return new Intl.NumberFormat("en", {
    style: renderCurrency ? "currency" : "decimal",
    currency: renderCurrency ? "USD" : undefined,
    minimumFractionDigits: clampedMin,
    maximumFractionDigits: clampedMax,
  }).format(value);
}

export function abbreviateAmount(
  value: number,
  { type, decimals = 2 }: { type: "usd" | "percentage" | "token"; decimals?: number }
) {
  const absValue = Math.abs(value);

  const threshold = 0.001;

  if (absValue !== 0 && absValue < threshold) {
    return type === "percentage" ? "<0.001" : "<0.001";
  }

  if (absValue < 1000) {
    return type === "percentage"
      ? absValue.toFixed(decimals)
      : formatUsdValue(absValue, {
          renderCurrency: false,
          minimumFractionDigits: decimals,
        });
  } else if (absValue < 1_000_000) {
    return `${(absValue / 1_000).toFixed(decimals)}K`;
  } else if (absValue < 1_000_000_000) {
    return `${(absValue / 1_000_000).toFixed(decimals)}M`;
  } else if (absValue < 1_000_000_000_000) {
    return `${(absValue / 1_000_000_000).toFixed(decimals)}B`;
  } else if (absValue < 1_000_000_000_000_000) {
    return `${(absValue / 1_000_000_000_000).toFixed(decimals)}T`;
  } else {
    return `${(absValue / 1_000_000_000_000_000).toFixed(decimals)}Q`;
  }
}

export function formatTokenAmount(
  value: number,
  symbol: string | undefined,
  options?: {
    maximumFractionDigits?: number;
    minimumFractionDigits?: number;
    roundingMode?: "floor" | "ceil";
    filterSmallAmounts?: boolean;
    abbreviate?: boolean;
  }
) {
  const shouldFilterSmallAmount = options?.filterSmallAmounts ?? false;

  if (!Number.isFinite(value)) {
    return `0${symbol ? "\xa0" + symbol : ""}`;
  }

  if (shouldFilterSmallAmount && Math.abs(value) < 0.001) {
    return `<0.001${symbol ? "\xa0" + symbol : ""}`;
  }

  // Handle abbreviation first
  if (options?.abbreviate) {
    const absValue = Math.abs(value);

    const formatAbbreviated = (val: number, suffix: string) => {
      const short = val.toFixed(1);
      return `${short.endsWith(".0") ? parseInt(short) : short}${suffix}`;
    };

    if (absValue >= 1_000_000_000) {
      return `${formatAbbreviated(value / 1_000_000_000, "B")}${symbol ? "\xa0" + symbol : ""}`;
    } else if (absValue >= 1_000_000) {
      return `${formatAbbreviated(value / 1_000_000, "M")}${symbol ? "\xa0" + symbol : ""}`;
    } else if (absValue >= 1_000) {
      return `${formatAbbreviated(value / 1_000, "K")}${symbol ? "\xa0" + symbol : ""}`;
    } else {
      return `${value}${symbol ? "\xa0" + symbol : ""}`;
    }
  }

  //  Default digit logic
  const defaultMaximumFractionDigits =
    value === 0
      ? 2
      : value > 0 && value < 1
        ? Math.ceil(Math.log10(1 / value)) + 2
        : Math.max(4 - Math.floor(Math.log10(value)), 2);

  const maximumFractionDigits = Math.max(
    0,
    Math.min(options?.maximumFractionDigits ?? defaultMaximumFractionDigits, 20)
  );

  const roundedValue =
    options?.roundingMode === "floor"
      ? Math.floor(value * 10 ** maximumFractionDigits) / 10 ** maximumFractionDigits
      : options?.roundingMode === "ceil"
        ? Math.ceil(value * 10 ** maximumFractionDigits) / 10 ** maximumFractionDigits
        : value;

  return `${tokenAmountFormatter({
    maximumFractionDigits,
    minimumFractionDigits: options?.minimumFractionDigits,
  }).format(roundedValue)}${symbol ? "\xa0" + symbol : ""}`;
}

export function formatAmountInputWithSeparators(input: string) {
  if (input === "") return "";
  const [integer, decimal] = input.split(".");
  const formattedInteger = new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(parseInt(integer || "0", 10));

  return decimal !== undefined ? `${formattedInteger}.${decimal}` : formattedInteger;
}
