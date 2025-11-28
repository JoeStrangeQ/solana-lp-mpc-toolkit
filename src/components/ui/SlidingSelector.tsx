import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Option<T extends string> = {
  id: T;
  element: React.ReactNode;
};

type SlidingSelectProps<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;

  className?: string; // wrapper style (bg, padding etc)
  highlightClassName?: string;
  containerPaddingInPixels?: { px: number; py: number };
};

export function SlidingSelect<T extends string>({
  options,
  value,
  onChange,
  className = "",
  containerPaddingInPixels = { px: 12, py: 6 },
  highlightClassName = "inner-white bg-white/5 backdrop-blur-md",
}: SlidingSelectProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pos, setPos] = useState({ left: 0, width: 0 });

  // Measure highlight position
  useEffect(() => {
    const el = refs.current[value];
    const parent = containerRef.current;
    if (!el || !parent) return;

    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    setPos({
      left: rect.left - parentRect.left,
      width: rect.width,
    });
  }, [value, options.length]);

  const setRef = (key: string) => (el: HTMLDivElement | null) => {
    refs.current[key] = el;
  };

  return (
    <div ref={containerRef} className={`relative flex rounded-full gap-2 bg-backgroundQuaternary ${className}`}>
      {/* Highlight */}

      <motion.div
        className="absolute top-0 bottom-0"
        animate={{ left: pos.left, width: pos.width }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
      >
        <motion.div
          className={`w-full h-full rounded-full ${highlightClassName}`}
          key={value}
          initial={{ scaleY: 1.3 }}
          animate={{ scaleY: 1 }}
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 40,
            mass: 0.5,
          }}
        />
      </motion.div>

      {/* Options */}
      {options.map((opt) => (
        <div
          key={opt.id}
          ref={setRef(opt.id)}
          onClick={() => onChange(opt.id)}
          className={`relative z-10 cursor-pointer flex items-center justify-center rounded-full`}
          style={{
            paddingRight: containerPaddingInPixels.px,
            paddingLeft: containerPaddingInPixels.px,
            paddingTop: containerPaddingInPixels.py,
            paddingBottom: containerPaddingInPixels.py,
          }}
        >
          {opt.element}
        </div>
      ))}
    </div>
  );
}
