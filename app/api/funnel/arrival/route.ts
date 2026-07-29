import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { arrivalView, shouldResumeProvisioning } from "@/app/lib/funnel/arrival-rules";
import { ensureProvisionClaim } from "@/app/lib/funnel/provision-deps";
import { driveProvisioningWithEvent } from "@/app/lib/funnel/provision-driver";

/**
 * The arrival poll + PRIMARY provisioning driver (funnel wrap U7; W13).
 * The family lands on /start/arrival seconds after paying — usually ahead
 * of the webhook — and each poll tick both reads the claim and, when the
 * claim is resumable, drives a bounded provisioning attempt under the
 * lease (the arrival page is the plan's primary out-of-band driver; the
 * cron sweep in Unit 8 is the fallback for families who never arrive).
 *
 * Trust boundary: ownership and payment are established through the
 * PARENT-SESSION reads (RLS-scoped) before any service-role work runs. A
 * foreign or signed-out session gets 401/404 and can neither read another
 * family's state nor cause an emit — the emit lives behind the drive,
 * which runs only after ownership held.
 *
 * GET, deliberately: this is a read-shaped poll whose side effect
 * (resuming OUR OWN stalled work) is idempotent and lease-arbitrated.
 */
export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const childId = new URL(req.url).searchParams.get("child");
  if (!childId) return NextResponse.json({ error: "child required" }, { status: 400 });

  // RLS-scoped: resolves only for the session parent's own child.
  const { data: child } = await supabase
    .from("children")
    .select("id")
    .eq("id", childId)
    .maybeSingle();
  if (!child) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: depositRows } = await supabase
    .from("deposits")
    .select("status, refunded_at")
    .eq("child_id", childId);
  // Live paid = the PAIR, never status alone (the half-broken paid-with-
  // refunded_at shape is refused everywhere since U14).
  const hasPaidDeposit = (depositRows ?? []).some(
    (d) => String(d.status) === "paid" && d.refunded_at == null
  );
  if (!hasPaidDeposit) {
    return NextResponse.json({ view: { kind: "redirect_dashboard" } });
  }

  // Service-role from here — ownership and payment are established.
  const admin = supabaseAdmin();
  const readClaim = async () => {
    const { data } = await admin
      .from("funnel_student_provisioning")
      .select("state, email, forwarding_state, lease_expires_at")
      .eq("child_id", childId)
      .maybeSingle();
    return data ?? null;
  };

  let claim = await readClaim();
  if (!claim) {
    // The webhook may have lost its claim insert to a crash after the
    // 200 (or simply not arrived yet). Payment is verified above, and the
    // insert is idempotent by UNIQUE(child_id) — healing here is safe.
    await ensureProvisionClaim(childId);
    claim = await readClaim();
  }

  if (
    claim &&
    shouldResumeProvisioning({
      state: String(claim.state),
      leaseExpiresAt: (claim.lease_expires_at as string | null) ?? null,
      now: new Date(),
    })
  ) {
    await driveProvisioningWithEvent(childId, `arrival:${user.id}`);
    claim = await readClaim();
  } else if (claim && String(claim.state) === "complete") {
    // Terminal for provisioning, but forwarding may still be progressing
    // (pending → verified → active) — the driver self-noops otherwise.
    await driveProvisioningWithEvent(childId, `arrival:${user.id}`);
    claim = await readClaim();
  }

  return NextResponse.json({
    view: arrivalView({
      hasPaidDeposit: true,
      claim: claim
        ? {
            state: String(claim.state),
            email: (claim.email as string | null) ?? null,
            forwardingState: String(claim.forwarding_state),
          }
        : null,
    }),
  });
}
