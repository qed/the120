"use client";

import { createContext, useCallback, useContext, useState } from "react";
import AccountModal from "./AccountModal";

type Ctx = { openAccountModal: () => void; closeAccountModal: () => void };

const AccountModalContext = createContext<Ctx | null>(null);

export function useAccountModal() {
  const ctx = useContext(AccountModalContext);
  if (!ctx) throw new Error("useAccountModal must be used within <AccountModalProvider>");
  return ctx;
}

export default function AccountModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openAccountModal = useCallback(() => setIsOpen(true), []);
  const closeAccountModal = useCallback(() => setIsOpen(false), []);

  return (
    <AccountModalContext.Provider value={{ openAccountModal, closeAccountModal }}>
      {children}
      <AccountModal isOpen={isOpen} onClose={closeAccountModal} />
    </AccountModalContext.Provider>
  );
}
