"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/client";

const TABS = [
  { label: "DASHBOARD", href: "/crm" },
  { label: "PIPELINE", href: "/crm/pipeline" },
  { label: "DOSSIERS", href: "/crm/dossiers" },
  { label: "LIBRARY", href: "/crm/library" },
] as const;

/**
 * The slim tab row under the blue band (brief §4): mono 11px letterspaced
 * chips, active = #0300ED filled; signed-in email + sign-out far right.
 * Client component only for pathname-driven active state and sign-out —
 * everything else in the chrome stays server-rendered.
 * Scrolls horizontally on narrow viewports (survive-at-375px contract).
 */
export default function CrmTabs({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) =>
    href === "/crm"
      ? pathname === "/crm"
      : pathname === href || pathname.startsWith(`${href}/`);

  const handleSignOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.push("/crm/login");
  };

  return (
    <nav
      aria-label="CRM sections"
      className="flex items-center gap-1.5 overflow-x-auto border-b border-crm-line bg-crm-card px-5 py-2 sm:px-7"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={isActive(tab.href) ? "page" : undefined}
          className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue ${
            isActive(tab.href)
              ? "bg-crm-blue text-white"
              : "text-crm-muted hover:text-crm-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}

      <span className="ml-auto flex flex-none items-center gap-3 pl-4">
        <span className="font-mono text-[10.5px] text-crm-faint">{email}</span>
        <button
          type="button"
          onClick={handleSignOut}
          className="cursor-pointer rounded-full font-mono text-[10.5px] uppercase tracking-[0.08em] text-crm-muted transition-colors hover:text-crm-red focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue"
        >
          Sign out
        </button>
      </span>
    </nav>
  );
}
