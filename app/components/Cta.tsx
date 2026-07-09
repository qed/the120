import Link from "next/link";

export type CtaVariant =
  | "primary" // red fill, white text
  | "ghost" // bordered, ink text (light surfaces)
  | "white" // white fill, ink text (dark/red surfaces)
  | "ghostLight"; // bordered white (dark/red surfaces)

/** Handoff button system: squared 10px radius, IBM Plex Mono labels. */
export const ctaBase =
  "inline-flex items-center justify-center rounded-[10px] px-5 py-3 font-mono text-[13px] font-medium uppercase tracking-[0.04em] whitespace-nowrap transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:duration-75";

export const ctaVariants: Record<CtaVariant, string> = {
  primary:
    "bg-red text-white hover:bg-red-dark shadow-sm shadow-red/20 hover:shadow-md hover:shadow-red/30",
  ghost: "border border-line-strong bg-transparent text-ink hover:border-ink",
  white: "bg-white text-ink hover:bg-paper shadow-sm shadow-ink/10 hover:shadow-md",
  ghostLight:
    "border-[1.5px] border-white/60 bg-transparent text-white hover:border-white hover:bg-white/10",
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
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      className={ctaClass(variant, className)}
      onClick={onClick}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener" : undefined}
    >
      {children}
    </Link>
  );
}
