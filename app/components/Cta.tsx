import Link from "next/link";

export type CtaVariant = "primary" | "secondary" | "ghost" | "ghostLight";

export const ctaBase =
  "inline-flex h-12 items-center justify-center rounded-full px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:duration-75";

export const ctaVariants: Record<CtaVariant, string> = {
  primary:
    "bg-red text-white hover:bg-red-dark shadow-sm shadow-red/20 hover:shadow-md hover:shadow-red/30",
  secondary: "bg-ink text-paper hover:bg-black hover:shadow-md hover:shadow-ink/20",
  ghost: "border border-line-strong bg-transparent text-ink hover:border-ink",
  ghostLight:
    "border border-white/40 bg-white/5 text-white backdrop-blur-sm hover:border-white/70 hover:bg-white/15",
};

export function ctaClass(variant: CtaVariant = "primary", className = "") {
  return `${ctaBase} ${ctaVariants[variant]} ${className}`;
}

/**
 * Shared link-style CTA (for navigational actions like "Book a call").
 * The "Join the 120" actions use <JoinButton>, which opens the account modal.
 */
export default function Cta({
  href = "#join",
  variant = "primary",
  className = "",
  onClick,
  children,
}: {
  href?: string;
  variant?: CtaVariant;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={ctaClass(variant, className)} onClick={onClick}>
      {children}
    </Link>
  );
}
