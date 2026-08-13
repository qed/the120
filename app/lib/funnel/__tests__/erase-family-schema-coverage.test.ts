/**
 * THE R28 COVERAGE TRIPWIRE.
 *
 * This test exists because the previous safeguard was memory. New User Flow v3
 * shipped `fp_onboarding_drafts` (a child's name, age, story answers and cover),
 * `fp_handoff_codes` (live sign-in codes), and six `children` columns — all
 * applied to production — while the family eraser knew about none of them, and
 * nothing anywhere went red.
 *
 * So this test does NOT re-state the eraser's list back to itself. It reads the
 * schema out of `supabase/migrations/*.sql` and asserts that every table and
 * column that could hold a child's data is CLASSIFIED in
 * `../erase-family-schema.ts`. A migration that adds one and stops there fails
 * the build; the only way to green is to write down what erasure does with it.
 * "Retained, because X" is an acceptable answer — an unexamined default is not.
 *
 * The "catches an ADDITION" claim is not asserted by assertion alone: the second
 * describe block INJECTS synthetic tables and columns into the parsed schema and
 * proves the audit reports each one. If the mechanism ever stops working, those
 * tests go red rather than going quiet.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditErasureCoverage,
  COLUMN_AUDITED_TABLES,
  ERASURE_COLUMN_LEDGER,
  ERASURE_EXTERNAL_OBJECT_LEDGER,
  ERASURE_TABLE_LEDGER,
  tablesInErasureScope,
  type CoverageFinding,
} from "../erase-family-schema";
import {
  CHILD_BLOB_KEY_COLUMNS,
  CHILD_LEAF_DELETE_ORDER,
  DRAFT_BLOB_KEY_COLUMNS,
  ERASURE_PRESERVED_TABLES,
  RELEASED_CLAIM_PII_COLUMNS,
  RELEASED_CLAIM_PRESERVED_COLUMN,
} from "../erase-family-rules";
import { PATH_EVIDENCE_BUCKET } from "../erase-family-rules";
import { IMAGE_LAB_BUCKET } from "@/app/staff/image-lab/lib/image-lab-rules";
import { FP_CHILD_MEDIA_BUCKET } from "@/app/lib/fp/child-photo/child-photo-rules";
import { parseMigrationSchema } from "./helpers/migration-schema";

const schema = parseMigrationSchema();

const show = (f: CoverageFinding[]): string =>
  f.map((x) => `  [${x.kind}] ${x.subject} — ${x.detail}`).join("\n");

describe("R28 erasure coverage — the ledger matches the real schema", () => {
  it("the schema reader is not vacuous (it found the tables this repo demonstrably has)", () => {
    // A silently-empty reader would make every assertion below pass while
    // proving nothing, which is the exact failure mode this file is about.
    expect(Object.keys(schema).length).toBeGreaterThan(40);
    for (const t of [
      "children",
      "fp_onboarding_drafts",
      "fp_handoff_codes",
      "fp_player_profiles",
      "funnel_student_provisioning",
    ]) {
      expect(schema[t], `${t} must be visible to the schema reader`).toBeTruthy();
    }
    // The two DDL forms a naive reader misses: a multi-clause ALTER
    // (20260714130000) and a RENAME (20260826120000).
    expect(schema.children).toContain("academics");
    expect(schema.children).toContain("workshop_ids_legacy");
    expect(schema.children).not.toContain("workshop_ids");
  });

  it("every child-linked table, audited column, and external-object column is classified", () => {
    const findings = auditErasureCoverage(schema);
    expect(
      findings,
      findings.length === 0
        ? ""
        : `\nR28 erasure coverage gap — the schema changed and the eraser's ledger did not:\n${show(findings)}\n\n` +
            "Fix by deciding what a family erasure does with each item and recording it in " +
            "app/lib/funnel/erase-family-schema.ts (and, if it must actually be deleted, in " +
            "erase-family-core.ts).\n"
    ).toEqual([]);
  });

  it("the v3 tables the eraser was missing are now classified as erased", () => {
    expect(ERASURE_TABLE_LEDGER.fp_onboarding_drafts.disposition).toBe("erased-explicitly");
    expect(ERASURE_TABLE_LEDGER.fp_handoff_codes.disposition).toBe("erased-explicitly");
    // And the executor really walks them (one definition of order, shared).
    expect(CHILD_LEAF_DELETE_ORDER).toContain("fp_onboarding_drafts");
    expect(CHILD_LEAF_DELETE_ORDER).toContain("fp_handoff_codes");
    // Drafts must precede the roster row — child_id is ON DELETE SET NULL, so a
    // children delete first would orphan them. (The `children` delete is not in
    // this list at all; it happens after every entry in it.)
    expect(CHILD_LEAF_DELETE_ORDER.indexOf("fp_onboarding_drafts")).toBeGreaterThanOrEqual(0);
  });

  it("the kid's identity payload on `children` is accounted for column by column", () => {
    const cols = ERASURE_COLUMN_LEDGER.children;
    for (const c of ["fp_kid_age", "fp_story_answers", "fp_cover_data_url", "first_name", "last_name"]) {
      expect(cols[c], `${c} must be classified`).toBe("row-deleted");
    }
    // The one column a row delete cannot erase.
    expect(cols.fp_cover_blob_key).toBe("external-object");
  });

  it("every external-object column is either really external (and deleted) or reasoned away", () => {
    for (const key of [
      "children.fp_cover_blob_key",
      "fp_onboarding_drafts.cover_blob_key",
      "fp_onboarding_drafts.photo_blob_key",
    ]) {
      expect(ERASURE_EXTERNAL_OBJECT_LEDGER[key].external).toBe(true);
    }
    // Non-external look-alikes must carry a stated reason, not silence.
    for (const [ref, entry] of Object.entries(ERASURE_EXTERNAL_OBJECT_LEDGER)) {
      expect(entry.note.length, `${ref} needs a reason`).toBeGreaterThan(20);
    }
  });

  it("the surviving-claim scrub list and the column ledger cannot drift apart", () => {
    const claim = ERASURE_COLUMN_LEDGER.funnel_student_provisioning;
    const scrubbed = Object.entries(claim)
      .filter(([, d]) => d === "scrubbed")
      .map(([c]) => c)
      .sort();
    expect(scrubbed).toEqual([...RELEASED_CLAIM_PII_COLUMNS].sort());
    // The never-reissue key is preserved, in both places.
    expect(claim[RELEASED_CLAIM_PRESERVED_COLUMN]).toBe("preserved");
    expect(ERASURE_TABLE_LEDGER[ERASURE_PRESERVED_TABLES[0]].disposition).toBe("retained");
  });

  it("the executor's static projections really ask for every blob-key column", () => {
    // supabase-js needs a LITERAL `.select("…")`, so the core cannot build its
    // projection from the constants. This closes that seam: add a third key
    // column to either constant and forget the query, and this goes red instead
    // of the object silently surviving every erasure.
    const core = readFileSync(
      path.resolve(process.cwd(), "app/lib/funnel/erase-family-core.ts"),
      "utf8"
    );
    const projections = [...core.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]).join(" | ");
    for (const col of [...DRAFT_BLOB_KEY_COLUMNS, ...CHILD_BLOB_KEY_COLUMNS]) {
      expect(projections, `${col} must appear in an erase-family-core .select(...) projection`).toContain(col);
    }
  });

  it("the Image Lab's classification is backed by an executor that really purges it", () => {
    // The classification is only honest if the code matches it. `runs` is
    // erased-explicitly and listed in the shared order; `images.storage_key` is
    // external:true, which is a PROMISE that the bytes are deleted — so the
    // executor must actually name that column and call the object-delete dep.
    expect(ERASURE_TABLE_LEDGER.fp_image_lab_runs.disposition).toBe("erased-explicitly");
    expect(CHILD_LEAF_DELETE_ORDER).toContain("fp_image_lab_runs");
    expect(ERASURE_EXTERNAL_OBJECT_LEDGER["fp_image_lab_images.storage_key"].external).toBe(true);
    const core = readFileSync(
      path.resolve(process.cwd(), "app/lib/funnel/erase-family-core.ts"),
      "utf8"
    );
    const projections = [...core.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]).join(" | ");
    expect(projections).toContain("storage_key");
    expect(core).toContain("deleteImageLabObject");
    // References are the deliberate NON-deletion, and it must stay reasoned.
    const refs = ERASURE_EXTERNAL_OBJECT_LEDGER["fp_image_lab_references.storage_key"];
    expect(refs.external).toBe(false);
    expect(refs.note).toMatch(/append-only/i);
  });

  /* ------------------------------- the child-photo bucket (child-photo Unit 1) */

  it("⚠ the child's SOURCE PHOTO is classified, enumerated, projected and really deleted", () => {
    // The tripwire in its intended shape, for the single most sensitive object
    // this system stores. Four independent links must all hold; break any one
    // and a photograph of a child survives a family erasure.
    //
    //   1. CLASSIFIED     — the column is in the external-object ledger as
    //                       external:true (a PROMISE that the bytes are deleted).
    //   2. ENUMERATED     — the eraser's key-column constant names it, so
    //                       planSubjectBlobDeletes plans a delete for it.
    //   3. PROJECTED      — the core's LITERAL .select(...) asks for it, because
    //                       supabase-js cannot build a projection from a constant.
    //   4. EXECUTED       — a real deleteBlob adapter exists and is wired, so a
    //                       found key is DELETED rather than stranded.
    const entry = ERASURE_EXTERNAL_OBJECT_LEDGER["children.fp_photo_blob_key"];
    expect(entry, "children.fp_photo_blob_key must be classified").toBeTruthy();
    expect(entry.external).toBe(true);
    expect(entry.note.length).toBeGreaterThan(20);
    expect(ERASURE_COLUMN_LEDGER.children.fp_photo_blob_key).toBe("external-object");

    expect(CHILD_BLOB_KEY_COLUMNS).toContain("fp_photo_blob_key");

    const core = readFileSync(
      path.resolve(process.cwd(), "app/lib/funnel/erase-family-core.ts"),
      "utf8"
    );
    const projections = [...core.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]).join(" | ");
    expect(projections).toContain("fp_photo_blob_key");
  });

  it("⚠ the blob classification is backed by an executor that CAN reach the store", () => {
    // For months `blobConfigured` was false and a non-null key was STRANDED
    // rather than deleted — correct while no store existed, and a live hole the
    // moment one did. This asserts the adapter is really wired, in the same
    // "classification backed by an executor" shape the Image Lab assertion uses.
    const deps = readFileSync(
      path.resolve(process.cwd(), "app/lib/funnel/provision-deps.ts"),
      "utf8"
    );
    const code = deps.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    expect(code).toMatch(/blobConfigured:\s*true/);
    expect(code).toMatch(/deleteBlob:\s*supabaseObjectEraser\(/);
    // ⚠ AND IT MUST NOT BE FLAGGED. Erasure is not a feature: tying deletion to
    // FP_CHILD_PHOTO_LIVE would turn every object written while the gate was on
    // into a strand the day someone turned it off.
    expect(code).not.toMatch(/blobConfigured:.*FP_CHILD_PHOTO_LIVE/);
    expect(code).not.toMatch(/blobConfigured:.*isChildPhotoLive/);
  });

  it("⚠ EVERY private bucket a migration creates is named by an erasure-aware constant", () => {
    // The tripwire's documented blind spot: it audits SQL COLUMNS and never sees
    // `insert into storage.buckets`. A future unit could add a bucket, store a
    // child's bytes in it, and trip nothing. So the buckets are read straight out
    // of the migrations and matched against the constants the eraser knows.
    const dir = path.resolve(process.cwd(), "supabase/migrations");
    const declared = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(path.join(dir, file), "utf8").replace(/--.*/g, "");
      for (const m of sql.matchAll(/insert\s+into\s+storage\.buckets[^;]*?values\s*\(\s*'([^']+)'/gi)) {
        declared.add(m[1]!);
      }
    }
    // Every bucket this repo creates, and the erasure path that reaches it.
    const ERASURE_AWARE_BUCKETS = new Set([
      PATH_EVIDENCE_BUCKET, // deps.deleteEvidenceObject (student graph drain)
      IMAGE_LAB_BUCKET, // deps.deleteImageLabObject (Image Lab purge)
      FP_CHILD_MEDIA_BUCKET, // deps.deleteBlob (child + draft blob erasure)
    ]);
    const unknown = [...declared].filter((b) => !ERASURE_AWARE_BUCKETS.has(b));
    expect(
      unknown,
      `a migration creates ${unknown.join(", ")} but no erasure path names it — classify it or add its deps seam`
    ).toEqual([]);
    // Non-vacuous: the reader really found the buckets.
    expect(declared.size).toBeGreaterThanOrEqual(3);
  });

  it("every column-audited table is also table-classified", () => {
    for (const t of COLUMN_AUDITED_TABLES) {
      expect(ERASURE_TABLE_LEDGER[t], `${t} needs a table disposition too`).toBeTruthy();
    }
  });
});

describe("R28 coverage tripwire — it actually catches an ADDITION", () => {
  /** The schema as it would look after a hypothetical future migration. */
  const withChange = (mutate: (s: Record<string, string[]>) => void): Record<string, string[]> => {
    const next: Record<string, string[]> = Object.fromEntries(
      Object.entries(schema).map(([t, c]) => [t, [...c]])
    );
    mutate(next);
    return next;
  };

  it("a NEW TABLE holding child data is reported as unclassified", () => {
    // e.g. `create table fp_kid_journals (id, child_id, entry_text)`.
    const findings = auditErasureCoverage(
      withChange((s) => {
        s.fp_kid_journals = ["id", "child_id", "entry_text", "created_at"];
      })
    );
    expect(findings.map((f) => `${f.kind}:${f.subject}`)).toContain(
      "unclassified-table:fp_kid_journals"
    );
  });

  it("a NEW TABLE hanging off an AUTH ACCOUNT (user_id) is reported — the leg the first live erasure was missing", () => {
    // Exactly the shape of path_role_grants: no child link anywhere, keyed on
    // the PARENT'S auth account, ON DELETE RESTRICT. The old child/profile-only
    // scope was structurally blind to it.
    const findings = auditErasureCoverage(
      withChange((s) => {
        s.fp_parent_badges = ["id", "user_id", "badge", "granted_at"];
        s.fp_parent_pings = ["id", "recipient_user_id", "sent_at"]; // suffix form too
      })
    );
    const seen = findings.map((f) => `${f.kind}:${f.subject}`);
    expect(seen).toContain("unclassified-table:fp_parent_badges");
    expect(seen).toContain("unclassified-table:fp_parent_pings");
  });

  it("a NEW COLUMN on `children` is reported as unclassified", () => {
    // Exactly the shape of the miss that produced this file: 20260918120000
    // added fp_kid_age + fp_story_answers and touched no erasure code.
    const findings = auditErasureCoverage(
      withChange((s) => {
        s.children.push("fp_favourite_colour");
      })
    );
    expect(findings.map((f) => `${f.kind}:${f.subject}`)).toContain(
      "unclassified-column:children.fp_favourite_colour"
    );
  });

  it("a NEW COLUMN on the surviving provisioning claim is reported as unclassified", () => {
    const findings = auditErasureCoverage(
      withChange((s) => {
        s.funnel_student_provisioning.push("recovery_email");
      })
    );
    expect(findings.map((f) => `${f.kind}:${f.subject}`)).toContain(
      "unclassified-column:funnel_student_provisioning.recovery_email"
    );
  });

  it("a NEW EXTERNAL-OBJECT column ANYWHERE — even on a table with no child link — is reported", () => {
    const findings = auditErasureCoverage(
      withChange((s) => {
        s.fp_public_sites.push("banner_blob_key");
        s.library_items.push("attachment_storage_key");
      })
    );
    const seen = findings.map((f) => `${f.kind}:${f.subject}`);
    expect(seen).toContain("unclassified-external-object:fp_public_sites.banner_blob_key");
    expect(seen).toContain("unclassified-external-object:library_items.attachment_storage_key");
  });

  it("a REMOVED table/column is reported too, so the ledger cannot rot", () => {
    const findings = auditErasureCoverage(
      withChange((s) => {
        s.children = s.children.filter((c) => c !== "fp_kid_age");
        delete s.fp_handoff_codes;
      })
    );
    const seen = findings.map((f) => `${f.kind}:${f.subject}`);
    expect(seen).toContain("stale-column:children.fp_kid_age");
    expect(seen).toContain("stale-table:fp_handoff_codes");
  });

  it("scope derivation is structural, not a hand-list", () => {
    const scope = tablesInErasureScope(schema);
    // Anchors + anything carrying child_id / profile_id.
    expect(scope).toContain("children");
    expect(scope).toContain("parents");
    expect(scope).toContain("fp_task_feedback"); // reached via profile_id only
    // A table with neither link is out of scope and needs no entry.
    expect(scope).not.toContain("library_items");
  });
});
