import { AnimatePresence, motion } from "motion/react";
import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import Backdrop from "./Backdrop";
import { cn } from "~/utils/cn";
import { useRouterState } from "@tanstack/react-router";

type Align = "left" | "right";

export function Dropdown({
  trigger,
  content,
  align = "right",
  className,
  dropdownClassName,
}: {
  trigger: ReactNode;
  content: ReactNode;
  align?: Align;
  className?: string;
  dropdownClassName?: string;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const alignClass = align === "left" ? "left-0" : "right-0";
  const originClass = align === "left" ? "origin-top-left" : "origin-top-right";

  useLayoutEffect(() => {
    setIsOpen(false);
  }, [pathname]);
  return (
    <div className={cn("relative inline-flex", className)}>
      {/* Full-screen backdrop */}
      <Backdrop show={isOpen} onClick={() => setIsOpen(false)} className="bg-black/30 backdrop-blur-none z-20" />

      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="outline-none relative z-20"
      >
        {trigger}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key={pathname}
            ref={dropdownRef}
            initial={{ opacity: 0, scale: 0.98, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "absolute w-max max-h-[400px] overflow-scroll custom-scrollbar top-full mt-2 px-3.5 py-2 rounded-2xl",
              "bg-backgroundTertiary border border-white/10 shadow-xl z-20",
              alignClass,
              originClass,
              dropdownClassName
            )}
            onClick={(e) => e.stopPropagation()}
            style={{ pointerEvents: isOpen ? "auto" : "none" }}
          >
            <motion.div
              initial={{ opacity: 0, x: align === "left" ? -15 : 15 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, x: align === "left" ? -15 : 15 }}
              transition={{ duration: 0.3 }}
            >
              {content}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
