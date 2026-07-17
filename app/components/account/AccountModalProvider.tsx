"use client";

import { createContext, useCallback, useContext, useState } from "react";
import AccountModal from "./AccountModal";

type OpenAccountModal = (onAuthed?: (userId: string) => void) => void;

type Ctx = { openAccountModal: OpenAccountModal; closeAccountModal: () => void };

const AccountModalContext = createContext<Ctx | null>(null);

export function useAccountModal() {
  const ctx = useContext(AccountModalContext);
  if (!ctx) throw new Error("useAccountModal must be used within <AccountModalProvider>");
  return ctx;
}

export default function AccountModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // Optional success callback supplied by whoever opened the modal (e.g. the
  // tournament entry flow, to capture the new user_id). Stored alongside isOpen.
  const [onAuthed, setOnAuthed] = useState<((userId: string) => void) | undefined>(undefined);
  const openAccountModal = useCallback<OpenAccountModal>((cb) => {
    // Wrap in an updater fn so React stores the callback rather than invoking it.
    setOnAuthed(() => cb);
    setIsOpen(true);
  }, []);
  const closeAccountModal = useCallback(() => {
    setIsOpen(false);
    setOnAuthed(undefined);
  }, []);

  return (
    <AccountModalContext.Provider value={{ openAccountModal, closeAccountModal }}>
      {children}
      <AccountModal isOpen={isOpen} onClose={closeAccountModal} onAuthed={onAuthed} />
    </AccountModalContext.Provider>
  );
}
