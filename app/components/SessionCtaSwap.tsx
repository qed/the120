"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/app/lib/supabase/client";

/**
 * Renders `signedOut` until a Supabase session is confirmed, then swaps to
 * `signedIn` — the Nav's session-aware CTA pattern, extracted so static
 * marketing surfaces (the landing template) can swap their funnel-entry CTAs
 * to "My dashboard" without becoming client components themselves. Both
 * branches arrive as server-rendered children; defaulting to signed-out means
 * the static render never flashes for anonymous visitors.
 */
export default function SessionCtaSwap({
  signedIn,
  signedOut,
}: {
  signedIn: React.ReactNode;
  signedOut: React.ReactNode;
}) {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(Boolean(session));
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });
    return () => subscription.unsubscribe();
  }, []);

  return <>{hasSession ? signedIn : signedOut}</>;
}
