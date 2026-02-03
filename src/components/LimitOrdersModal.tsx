import { cn } from "~/utils/cn";
import {
  OrderDirection,
  SupportedMarket,
  SwapToOption,
  LimitOrderInput as LimitOrderInputType,
} from "../../convex/schema/limitOrders";
import {
  Address,
  getMarketFromMints,
  mints,
  tokensMetadata,
} from "../../convex/utils/solana";
import { TokenIcon } from "./TokenIcon";
import { Row } from "./ui/Row";
import { SlidingSelect } from "./ui/SlidingSelector";
import { ReactNode, SetStateAction, useEffect, useState } from "react";
import { formatAmountInputWithSeparators } from "~/utils/numberFormats";
import { Button } from "./ui/Button";
import { FormattedBinPrice } from "./FormattedBinPrice";
import { PenLine } from "lucide-react";
import { Modal } from "./ui/Modal";
import { LabelValue } from "./ui/labelValueRow";
import { usePool } from "~/states/pools";

const swapToItems: { id: SwapToOption; element: ReactNode }[] = [
  {
    id: "none",
    element: (
      <div className={cn("text-xs font-normal whitespace-nowrap", "text-text")}>
        No Swap
      </div>
    ),
  },
  {
    id: "SOL",
    element: (
      <Row
        justify="start"
        className={cn(
          "gap-1 text-xs font-normal whitespace-nowrap",
          "text-text",
        )}
      >
        <TokenIcon
          className="w-3.5 h-3.5"
          icon={tokensMetadata[mints.sol].icon}
        />
        SOL
      </Row>
    ),
  },
  {
    id: "USDC",
    element: (
      <Row
        justify="start"
        className={cn(
          "gap-1 text-xs font-normal whitespace-nowrap",
          "text-text l",
        )}
      >
        <TokenIcon
          className="w-3.5 h-3.5"
          icon={tokensMetadata[mints.usdc].icon}
        />
        USDC
      </Row>
    ),
  },
];

export function LimitOrderValues({
  poolAddress,
  sl,
  tp,
  disableEdit = false,
  onSaveOrders,
}: {
  poolAddress: Address;
  sl?: LimitOrderInputType;
  tp?: LimitOrderInputType;
  disableEdit?: boolean;
  onSaveOrders?: (sl: LimitOrderInputType, tp: LimitOrderInputType) => void;
}) {
  const pool = usePool({ poolAddress, protocol: "dlmm" });
  const market = getMarketFromMints(pool.mint_x, pool.mint_y);
  const [showModifyModal, setShowModifyModal] = useState(false);

  return (
    <>
      <Row
        justify="start"
        className={cn(
          " gap-px ",
          !disableEdit && " group cursor-pointer active:scale-95",
        )}
        onClick={() => !disableEdit && setShowModifyModal(true)}
      >
        {!sl?.price || sl.price === 0 ? (
          <div className="text-sm text-textSecondary group-hover:text-text font-normal hover-effect group-hover:underline">
            --
          </div>
        ) : (
          <FormattedBinPrice
            value={sl.price}
            classname="text-sm text-text group-hover:text-text font-normal hover-effect group-hover:underline"
            significantDigits={4}
          />
        )}

        <div className="text-sm text-text group-hover:text-text font-normal hover-effect group-hover:underline">
          /
        </div>

        {!tp?.price || tp.price === 0 ? (
          <div className="text-sm text-textSecondary group-hover:text-text font-normal hover-effect group-hover:underline">
            --
          </div>
        ) : (
          <FormattedBinPrice
            value={tp.price}
            classname="text-sm text-text group-hover:text-text font-normal hover-effect group-hover:underline"
            significantDigits={4}
          />
        )}

        {!disableEdit && (
          <PenLine className="w-2.5 h-2.5 ml-1 text-textSecondary group-hover:text-text hover-effect group-hover:underline" />
        )}
      </Row>

      <Modal
        title="Set Stop Loss & Take Profit"
        show={showModifyModal}
        onClose={() => setShowModifyModal(false)}
        main={
          <LimitOrdersModalContent
            market={market}
            poolPrice={pool.current_price}
            initialSl={sl}
            initialTp={tp}
            onSaveOrders={(sl, tp) => {
              onSaveOrders?.(sl, tp);
              setShowModifyModal(false);
            }}
          />
        }
      />
    </>
  );
}

export function LimitOrdersModalContent({
  market,
  poolPrice,
  initialSl,
  initialTp,
  onSaveOrders,
}: {
  market: SupportedMarket;
  poolPrice: number;
  initialSl?: LimitOrderInputType;
  initialTp?: LimitOrderInputType;
  onSaveOrders: (sl: LimitOrderInputType, tp: LimitOrderInputType) => void;
}) {
  const [sl, setSl] = useState<LimitOrderInputType>(
    initialSl ?? { price: 0, swapTo: "none" },
  );

  const [tp, setTp] = useState<LimitOrderInputType>(
    initialTp ?? { price: 0, swapTo: "none" },
  );

  const invalidSl =
    sl.price !== undefined && sl.price !== 0 && sl.price >= poolPrice;
  const invalidTp =
    tp.price !== undefined && tp.price !== 0 && tp.price <= poolPrice;

  const isInitialSl = initialSl
    ? sl.price === initialSl.price && sl.swapTo === initialSl.swapTo
    : sl.price === 0; // unchanged when no initial was given
  const isInitialTp = initialTp
    ? tp.price === initialTp.price && tp.swapTo === initialTp.swapTo
    : tp.price === 0;

  const isInitialValues = isInitialSl && isInitialTp;
  const disableSave = invalidSl || invalidTp || isInitialValues;
  return (
    <div className="flex flex-col w-[440px]">
      {/* SL INPUTS */}
      <div className="flex flex-col gap-1 mb-4">
        <LabelValue
          variant="row"
          label={"Market"}
          value={market}
          labelClassName="text-xs"
        />
        <LabelValue
          variant="row"
          label={"Pool Price"}
          value={<FormattedBinPrice value={poolPrice} significantDigits={4} />}
          labelClassName="text-xs"
        />
        <LabelValue
          variant="row"
          label={"Oracle Price"}
          value={0}
          labelClassName="text-xs"
        />
      </div>
      <LimitOrderInput
        direction="sl"
        order={sl}
        market={market}
        marketPrice={poolPrice}
        onPrice={(p) => setSl((s) => ({ ...s, price: p }))}
        onSwapTo={(val) => setSl((s) => ({ ...s, swapTo: val }))}
      />

      {/* TP INPUTS */}
      <LimitOrderInput
        direction="tp"
        market={market}
        order={tp}
        marketPrice={poolPrice}
        onPrice={(p) => setTp((s) => ({ ...s, price: p }))}
        onSwapTo={(val) => setTp((s) => ({ ...s, swapTo: val }))}
      />

      <Button
        variant="liquidPrimary"
        onClick={() => onSaveOrders(sl, tp)}
        disabled={disableSave}
      >
        Save
      </Button>
    </div>
  );
}

function LimitOrderInput({
  market,
  direction,
  order,
  marketPrice,
  onPrice,
  onSwapTo,
}: {
  market: SupportedMarket;
  direction: OrderDirection;
  order: LimitOrderInputType;
  marketPrice: number;
  onPrice: (price: number) => void;
  onSwapTo: (val: SwapToOption) => void;
}) {
  const label = direction === "sl" ? "Stop Loss" : "Take Profit";
  const [err, setErr] = useState("");

  // Format price safely

  const [priceInput, setPriceInput] = useState("");
  const [pctInput, setPctInput] = useState("");

  useEffect(() => {
    if (order.price === 0) {
      setPctInput("");
      setPriceInput("");
    } else {
      const raw = String(order.price);

      setPriceInput(order.price === 0 ? "0" : raw);

      const pct = computePercentage(order.price, marketPrice);
      const clamped =
        pct < 0
          ? "0"
          : direction === "sl" && pct > 100
            ? "100"
            : pct.toFixed(2).replace(/\.00$/, "");

      setPctInput(clamped);
    }
  }, [order.price, marketPrice]);

  return (
    <div className="flex flex-col w-full mb-3">
      <Row fullWidth>
        <div className="text-text text-sm mb-2.5">{label}</div>
        <button
          className="text-textSecondary text-xs mb-2.5 font-normal select-none active:scale-95 hover:text-text underline cursor-pointer hover-effect"
          onClick={() => {
            setPctInput("");
            setPriceInput("");
            onPrice(0);
          }}
        >
          Clear
        </button>
      </Row>
      <Row fullWidth justify="start">
        {/* PRICE INPUT */}
        <Row
          className={cn(
            "bg-white/5 border border-white/10 rounded-xl rounded-r-none px-2 py-3 w-full",
            err && "border-red/30",
          )}
        >
          <input
            placeholder="0.00"
            value={formatAmountInputWithSeparators(priceInput)}
            onChange={(e) => {
              const raw = e.target.value.replaceAll(",", "");

              // --- NEW: if the field is emptied, reset both price + percentage ---
              if (raw === "") {
                setPriceInput("");
                onPrice(0);
                setPctInput(""); // ← clear percentage
                setErr("");
                return;
              }

              const num = Number(raw);
              if (isNaN(num)) return;

              setPriceInput(raw);
              onPrice(num);

              // Update percentage
              const pct = computePercentage(num, marketPrice);

              if (pct < 0) {
                setPctInput("0");
              } else if (pct > 100) {
                setPctInput("100");
              } else {
                setPctInput(pct.toFixed(2).replace(/\.00$/, ""));
              }

              // Validation
              if (direction === "sl" && num >= marketPrice)
                return setErr("Stop loss must be below market price");

              if (direction === "tp" && num <= marketPrice)
                return setErr("Take profit must be above market price");

              setErr("");
            }}
            className="text-text placeholder:text-textSecondary text-sm outline-none w-full"
          />
          <div className="text-textSecondary text-xs ml-1">{market}</div>
        </Row>

        {/* PERCENTAGE INPUT */}
        <Row
          className={cn(
            "bg-white/5  border border-l-0 border-white/10 rounded-xl rounded-l-none px-2 py-3 w-[120px]",
            err && "border-red/30",
          )}
        >
          {/* SIGN IS DECIDED BY DIRECTION  {direction === "sl" ? "-" : "+"} */}
          <div className="text-textSecondary text-xs mr-1">
            {!order.price && direction === "tp"
              ? "+"
              : (order.price ?? 0) >= marketPrice
                ? "+"
                : "-"}
          </div>

          <input
            placeholder="0.00"
            value={pctInput}
            onChange={(e) =>
              onPercentageChange({
                raw: e.target.value,
                direction,
                marketPrice,
                onPrice,
                setErr,
                setPriceInput,
                setPctInput,
              })
            }
            className="text-text placeholder:text-textSecondary text-sm outline-none text-center w-full"
          />

          <div className="text-textSecondary text-xs ml-1">%</div>
        </Row>
      </Row>

      {/* ERROR + SWAP SELECTOR */}
      <Row className="justify-between mt-1.5 w-full">
        <div className="text-red text-xs font-normal min-h-8">{err}</div>

        <SlidingSelect
          className="gap-2 bg-white/5 backdrop-blur-3xl w-max"
          options={swapToItems}
          value={order.swapTo}
          containerPaddingInPixels={{ px: 8, py: 8 }}
          onChange={(id) => onSwapTo(id)}
        />
      </Row>
    </div>
  );
}

function computePercentage(price: number, marketPrice: number) {
  if (price === undefined) return 0;

  return Math.abs((price - marketPrice) / marketPrice) * 100;
}

function onPercentageChange({
  raw,
  direction,
  marketPrice,
  onPrice,
  setPriceInput,
  setPctInput,
  setErr,
}: {
  raw: string;
  direction: OrderDirection;
  marketPrice: number;
  onPrice: (price: number) => void;
  setPctInput: (value: SetStateAction<string>) => void;
  setPriceInput: (value: SetStateAction<string>) => void;
  setErr: (value: SetStateAction<string>) => void;
}) {
  // Allow empty — NEW: clear both pct and price
  if (raw === "") {
    setPctInput("");
    setPriceInput("");
    onPrice(0);
    setErr("");
    return;
  }

  // Reject negatives typed manually
  if (raw.startsWith("-")) return;

  // Only allow numeric formats
  if (!/^\d*\.?\d*$/.test(raw)) return;

  // Parse numeric value
  let num = Number(raw);

  // Clamp rules
  if (direction === "sl") {
    // SL must stay between 0–100%
    if (num < 0) num = 0;
    if (num > 100) num = 100;
  } else {
    // TP has NO upper bound
    if (num < 0) num = 0;
  }

  // Keep raw text unless SL forced clamp
  let display = raw;

  // Hard clamp only for SL
  if (direction === "sl" && Number(raw) > 100) {
    display = "100";
    num = 100;
  }

  setPctInput(display);

  // Still typing decimals → don't update price yet
  if (display.endsWith(".")) return;

  // Skip invalid numbers
  if (isNaN(num)) return;

  // Convert percentage → price
  const newPrice =
    direction === "sl"
      ? marketPrice * (1 - num / 100)
      : marketPrice * (1 + num / 100);

  setPriceInput(String(newPrice));
  onPrice(newPrice);

  // Validation
  if (direction === "sl" && newPrice >= marketPrice)
    return setErr("Stop loss must be below market price");

  if (direction === "tp" && newPrice <= marketPrice)
    return setErr("Take profit must be above market price");

  setErr("");
}
