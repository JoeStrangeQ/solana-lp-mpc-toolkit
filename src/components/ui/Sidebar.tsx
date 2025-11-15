import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import Backdrop from "./Backdrop";

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, children }) => {
  // ESC key close logic stays the same
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="z-50">
          <Backdrop show onClick={onClose} />
          <motion.div
            key="sidebar"
            className="fixed flex px-5 pt-12 top-6 right-5 h-[calc(100vh-48px)] w-104 bg-white/5 inner-white backdrop-blur-lg z-50 rounded-4xl"
            initial={{ x: "110%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "110%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
// Hook to manage the sidebar state with keyboard shortcut
export const useWalletSidebar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const toggle = () => setIsOpen((prev) => !prev);

  // C key shortcut to open the sidebar
  // useEffect(() => {
  //   const handleKeyDown = (e: KeyboardEvent) => {
  //     // Only trigger if user isn't typing in an input field
  //     if (
  //       e.key === 'c' &&
  //       !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
  //     ) {
  //       toggle()
  //     }
  //   }

  //   window.addEventListener('keydown', handleKeyDown)
  //   return () => window.removeEventListener('keydown', handleKeyDown)
  // }, [toggle])

  return { isOpen, open, close, toggle };
};
