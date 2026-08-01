import { describe, it, expect } from "vitest";
import { buildWorkspaceJwtConfig } from "@/app/lib/funnel/workspace-auth";

const KEY = JSON.stringify({
  client_email: "svc@proj.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
});
const DIR = ["https://www.googleapis.com/auth/admin.directory.user"];

describe("buildWorkspaceJwtConfig", () => {
  it("parses client_email + private_key and carries the scopes", () => {
    const cfg = buildWorkspaceJwtConfig(KEY, DIR, "");
    expect(cfg.email).toBe("svc@proj.iam.gserviceaccount.com");
    expect(cfg.key).toContain("BEGIN PRIVATE KEY");
    expect(cfg.scopes).toEqual(DIR);
  });

  it("includes subject (DWD impersonation) when a non-empty admin subject is given", () => {
    const cfg = buildWorkspaceJwtConfig(KEY, DIR, "admin@the120.school");
    expect(cfg.subject).toBe("admin@the120.school");
  });

  it("trims a padded subject", () => {
    const cfg = buildWorkspaceJwtConfig(KEY, DIR, "  admin@the120.school  ");
    expect(cfg.subject).toBe("admin@the120.school");
  });

  it("OMITS subject entirely when unset/empty/whitespace/null (SA-as-itself)", () => {
    for (const s of ["", "   ", undefined, null]) {
      const cfg = buildWorkspaceJwtConfig(KEY, DIR, s as string | null | undefined);
      expect("subject" in cfg).toBe(false);
    }
  });

  it("does not mutate the caller's scopes array", () => {
    const scopes = [...DIR];
    const cfg = buildWorkspaceJwtConfig(KEY, scopes, "a@b.c");
    cfg.scopes.push("extra");
    expect(scopes).toEqual(DIR);
  });

  it("throws (fails loud) on a key JSON missing client_email or private_key", () => {
    expect(() => buildWorkspaceJwtConfig(JSON.stringify({ private_key: "x" }), DIR, "")).toThrow(
      /client_email/
    );
    expect(() =>
      buildWorkspaceJwtConfig(JSON.stringify({ client_email: "a@b.c" }), DIR, "")
    ).toThrow(/private_key/);
  });

  it("throws on malformed JSON rather than producing a bad client", () => {
    expect(() => buildWorkspaceJwtConfig("{not json", DIR, "")).toThrow();
  });
});
