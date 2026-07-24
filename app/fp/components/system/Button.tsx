import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import type { Skin } from "@/app/fp/lib/skin-tokens";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  skin?: Skin;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

/**
 * Button — the one action primitive both skins share. HQ finish is crisp and
 * squared; Trail finish is rounder and warmer. The per-skin class lists are
 * spelled out in full (Decision 9's class-name swap): the skin selects which
 * complete utility string applies, rather than overriding a token at runtime.
 */
export function Button({
  skin = "hq",
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  const isTrail = skin === "trail";

  const base = cn(
    "inline-flex items-center justify-center font-medium select-none transition-all",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "disabled:opacity-50 disabled:pointer-events-none active:translate-y-px",
    isTrail ? "rounded-full" : "rounded-lg",
  );

  const variants: Record<Variant, string> = {
    primary: isTrail
      ? "bg-trail-ink text-trail-surface shadow-trail hover:brightness-110 focus-visible:ring-trail-ink/40 focus-visible:ring-offset-trail-surface"
      : "bg-hq-ink text-white shadow-hq hover:bg-hq-ink/90 focus-visible:ring-hq-ink/30 focus-visible:ring-offset-hq-surface",
    secondary: isTrail
      ? "bg-trail-surface text-trail-ink border-2 border-trail-ink/15 hover:border-trail-ink/30 focus-visible:ring-trail-ink/30"
      : "bg-hq-canvas text-hq-ink border border-hq-border-strong hover:bg-hq-sunken focus-visible:ring-hq-ink/20",
    ghost: isTrail
      ? "text-trail-ink-soft hover:bg-trail-ink/5 focus-visible:ring-trail-ink/20"
      : "text-hq-ink-soft hover:bg-hq-sunken focus-visible:ring-hq-ink/20",
  };

  return (
    <button className={cn(base, sizes[size], variants[variant], className)} {...props}>
      {icon}
      {children}
    </button>
  );
}
