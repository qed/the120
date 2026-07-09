"use client";

import { ctaClass, type CtaVariant } from "./Cta";
import { useAccountModal } from "./account/AccountModalProvider";

/**
 * Every "Join the 120" call to action — opens the account-creation modal
 * (brief §13.1: every CTA → create account).
 */
export default function JoinButton({
  variant = "primary",
  className = "",
  children = "Join the 120",
  onClick,
}: {
  variant?: CtaVariant;
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const { openAccountModal } = useAccountModal();
  return (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        openAccountModal();
      }}
      className={ctaClass(variant, className)}
    >
      {children}
    </button>
  );
}
