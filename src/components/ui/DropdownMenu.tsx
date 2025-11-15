"use client"; // @NOTE: Add in case you are using Next.js

import { useState, createContext, useContext, useEffect, RefObject, useRef } from "react";

import { AnimatePresence, motion, type Variants } from "motion/react";

import { Slot } from "@radix-ui/react-slot";
import { cn } from "~/utils/cn";
import { useRouterState } from "@tanstack/react-router";
import { useOnClickOutside } from "~/hooks/useOnClickOutside";

const content: Variants = {
  hidden: {
    clipPath: "inset(10% 50% 90% 50% round 12px)",
  },
  show: {
    clipPath: "inset(0% 0% 0% 0% round 12px)",
    transition: {
      type: "spring",
      bounce: 0,
      duration: 0.5,
      delayChildren: 0.15,
      staggerChildren: 0.1,
    },
  },
};

const item: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.3,
    filter: "blur(20px)",
  },
  show: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
  },
};

type DropdownMenuProps = React.ComponentProps<"nav">;

export function DropdownMenu({ className, children, ...props }: DropdownMenuProps) {
  return (
    <DropdownMenuProvider>
      <nav className={cn("mx-auto w-full max-w-[200px] ", className)} {...props}>
        {children}
      </nav>
    </DropdownMenuProvider>
  );
}

type DropdownMenuTriggerProps = {
  asChild?: boolean;
} & React.ComponentProps<"button">;

export function DropdownMenuTrigger({ asChild = false, children, className, ...props }: DropdownMenuTriggerProps) {
  const { setIsOpen } = useDropdownMenu();

  const Comp = asChild ? Slot : "button";

  return (
    <Comp className={className} onClick={() => setIsOpen((prev) => !prev)} {...props}>
      {children}
    </Comp>
  );
}

type DropdownMenuContentProps = {
  floating?: boolean;
  alignment?: "right" | "left";
} & React.ComponentProps<typeof motion.ul>;

export function DropdownMenuContent({
  children,
  floating = true,
  className,
  alignment = "left",
  ...props
}: DropdownMenuContentProps) {
  const { isOpen, setIsOpen } = useDropdownMenu();
  const dropdownRef = useRef<HTMLUListElement>(null);

  useOnClickOutside(dropdownRef as RefObject<HTMLElement>, () => setIsOpen(false));
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.ul
          ref={dropdownRef}
          key="dropdown-menu"
          className={cn(
            "z-50 flex flex-col gap-1.5 rounded-xl px-2.5 py-3 w-max max-w-[calc(100vw-32px)] overflow-y-auto custom-scrollbar",
            "bg-white/15 inner-white backdrop-blur-3xl",
            floating ? "absolute" : "relative",
            alignment === "left" ? "left-0" : "right-0",
            className
          )}
          variants={content}
          initial="hidden"
          animate="show"
          exit="hidden" // 👈 now this will actually run
          transition={{ duration: 0.2 }}
          {...props}
        >
          {children}
        </motion.ul>
      )}
    </AnimatePresence>
  );
}

type DropdownMenuItemProps = {
  asChild?: boolean;
} & React.ComponentProps<"button">;

export function DropdownMenuItem({ asChild = false, children, className, ...props }: DropdownMenuItemProps) {
  const { setIsOpen } = useDropdownMenu(); // 👈 access context
  const Comp = asChild ? Slot : "button";

  return (
    <motion.li
      variants={item}
      transition={{ duration: 0.2 }}
      onClick={() => {
        setIsOpen(false); // 👈 close menu
      }}
    >
      <Comp
        className={cn(
          "flex flex-row w-full items-center py-1.5 px-2 hover-effect hover:bg-white/5 rounded-xl overflow-hidden cursor-pointer active:scale-95",
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    </motion.li>
  );
}
const Context = createContext(
  {} as {
    isOpen: boolean;
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  }
);

function DropdownMenuProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const routerState = useRouterState();
  const value = { isOpen, setIsOpen };

  useEffect(() => {
    setIsOpen(false);
  }, [routerState.location.pathname]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDropdownMenu() {
  const context = useContext(Context);
  if (!context) {
    throw new Error("useDropdownMenu must be used within a DropdownMenuProvider");
  }
  return context;
}
