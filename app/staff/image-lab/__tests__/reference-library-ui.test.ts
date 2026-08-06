import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The reference picker's few SOURCE-LEVEL facts
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4 requirements 5, 8 and 9).
 *
 * ── THIS FILE USED TO BE NINE GREPS THAT PROVED NOTHING ────────────────────
 * Review mutated the component nine ways and every one of them stayed green:
 * deleting `min-h-11` from the reference card (the docblock's own prose padded
 * the `>= 4` count, because the check read UNSTRIPPED source); adding a
 * hardcoded lowercase sentence (the "no hardcoded copy" regex required a
 * capital); hardcoding an attribute value; adding `hidden` to the permanence
 * warning; DELETING the permanence warning outright while keeping its copy
 * alive in a dead const; and changing the grid to two columns at 390px.
 *
 * The fix is not a better regex. The upload phase/notice decisions and the
 * toggle/limit decisions MOVED into `lib/reference-rules.ts` as pure functions
 * (`reduceUploadStep`, `decideReferenceRefresh`, `toggleReferenceSelection`,
 * `clampReferenceSelection`) and are unit-tested there, branch by branch. What
 * remains here is the short list of facts that genuinely live only in the JSX
 * and that a pure test cannot reach — asserted over COMMENT-STRIPPED source, so
 * this file's own prose can never satisfy it.
 *
 * Honest about its limits: this cannot prove the page LOOKS right at 390px.
 * That is the manual viewport check the project instructions require.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", `file://${dir}`));
const COMPONENT = "app/staff/image-lab/ReferenceLibrary.tsx";
const BENCH = "app/staff/image-lab/page.tsx";

/**
 * ⚠ COMMENTS AND JSX COMMENTS REMOVED BEFORE EVERY ASSERTION, INCLUDING THE
 * COUNTING ONES. Reading raw source is what let the docblock's own explanation
 * of `min-h-11` keep the tap-target count above its floor after the class was
 * deleted from the card.
 */
const stripComments = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (file: string) => stripComments(readFileSync(`${REPO_ROOT}${file}`, "utf8"));

/** The JSX only — everything from the `return (` of the component onward. A
 *  copy constant that is never rendered lives above this line. */
const markupOf = (source: string) => source.slice(source.indexOf("return ("));

describe("the reference picker states what cannot be undone", () => {
  it("RENDERS the permanence warning — not merely references it", () => {
    // Deleting the warning while keeping the copy constant alive in a dead
    // binding used to pass. Asserted against the MARKUP slice, so it must be
    // inside what the component returns.
    const markup = markupOf(read(COMPONENT));
    expect(markup).toContain("IMAGE_LAB_REFERENCE_COPY.permanence.headline");
    expect(markup).toContain("IMAGE_LAB_REFERENCE_COPY.permanence.body");
  });

  it("does not hide the warning it is required to show", () => {
    // `hidden`, `sr-only`, and a zero-opacity wrapper all render the warning
    // technically present and practically absent.
    const markup = markupOf(read(COMPONENT));
    const warningBlock = markup.slice(
      Math.max(0, markup.indexOf("permanence.headline") - 400),
      markup.indexOf("permanence.body") + 200
    );
    expect(warningBlock).not.toMatch(/\b(hidden|sr-only|opacity-0)\b/);
  });

  it("is mounted where a staff member can reach it", () => {
    // An unmounted picker is dead code that passes every test above.
    //
    // ⚠ THE MOUNT MOVED IN UNIT 5, and the whole CHAIN is asserted rather than
    // just the leaf. The composer now owns the picker as a CONTROLLED child (it
    // holds the selection, and the picker's budget is the strictest limit across
    // the chosen models), so the bench mounts `RunComposer` and `RunComposer`
    // mounts `ReferenceLibrary`. Asserting only the inner mount would stay green
    // if the composer itself were dropped from the page.
    expect(read(BENCH)).toMatch(/<RunComposer[\s/>]/);
    const composer = read("app/staff/image-lab/RunComposer.tsx");
    expect(composer).toMatch(/<ReferenceLibrary[\s/>]/);
    // The composer renders its sections by MAPPING over the tested order
    // constant, so a section present in the record is a section on the screen.
    expect(markupOf(composer)).toMatch(/IMAGE_LAB_COMPOSER_SECTIONS\.map/);
    expect(composer).toMatch(/references:\s*\(/);
    // …and it is CONTROLLED: the composer supplies both halves, or the reference
    // set the run persists is not the set the picker is counting.
    expect(composer).toMatch(/selectedIds=\{referenceIds\}/);
    expect(composer).toMatch(/onSelectionChange=\{setReferenceIds\}/);
    expect(composer).toMatch(/modelIds=\{modelIds\}/);
  });
});

describe("the upload leg is the SHIPPED one, not a hand-rolled copy", () => {
  it("goes through uploadWithSlot and constructs no transport of its own", () => {
    // The already-exists→success mapping differs per leg (storage-js parses
    // `statusCode`; tus-js-client buries the 409 in a body it never parses) and
    // this repo has paid to discover it twice. A local `fetch`/`XHR`/`new
    // Upload(...)` here would be a third implementation with no tests — and the
    // one whose retries land on the append-only table.
    const source = read(COMPONENT);
    expect(source).toContain("uploadWithSlot(");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/new\s+XMLHttpRequest\b/);
    expect(source).not.toMatch(/new\s+Upload\s*\(/);
    expect(source).not.toMatch(/\.uploadToSignedUrl\s*\(/);
  });

  it("hands the transfer an abort handle and a progress callback", () => {
    // An abandoned TUS transfer with no `registerUpload` leaves an invisible
    // incomplete multipart that no bucket-vs-row reconciliation can see; a
    // 25 MB phone upload with no `onProgress` reads as a hung page.
    const source = read(COMPONENT);
    expect(source).toMatch(/registerUpload:/);
    expect(source).toMatch(/onProgress:/);
    expect(source).toMatch(/\.abort\(\)/);
  });

  it("REUSES a held slot instead of minting a fresh key per submit", () => {
    // ⚠ The retry guarantee. A fresh `mintReferenceUploadSlot` on every submit
    // means a retry uploads a SECOND full-size object under a new key, with one
    // row and no sweeper — and makes the server's 23505 re-read unreachable
    // from this UI, because two attempts never share a key.
    const source = read(COMPONENT);
    expect(source).toMatch(/held\s*&&\s*held\.fileKey\s*===\s*fileKey/);
    expect(source).toMatch(/setHeld\(\s*\{\s*slot:/);
  });

  it("refreshes the grid OUTSIDE the upload try block", () => {
    // ⚠ Once register returns ok, NOTHING may claim nothing was saved.
    // `refresh()` re-enters the gate and can throw; inside the try its failure
    // overwrites "Reference added." with "Nothing was saved — try again" over an
    // already-cleared form, and the staff member creates a second permanent row.
    const body = read(COMPONENT);
    const start = body.indexOf("async function onUpload");
    const fn = body.slice(start, body.indexOf("\n  }", start));
    const catchAt = fn.indexOf("} catch {");
    const refreshAt = fn.lastIndexOf("await refresh()");
    expect(catchAt, "onUpload must have a catch").toBeGreaterThan(-1);
    expect(refreshAt, "onUpload must refresh the grid").toBeGreaterThan(-1);
    expect(refreshAt, "refresh() must come AFTER the try/catch").toBeGreaterThan(catchAt);
  });
});

describe("the picker reports its clamp rather than only rendering it", () => {
  it("commits the clamped selection through the selection channel", () => {
    // ⚠ A derived value the parent cannot see is not a repair. Rendering
    // "4 of 4 selected" while the parent still holds eleven is the silent
    // truncation `refImageLimitFor` exists to prevent, concealed by the counter
    // that was supposed to reveal it.
    const source = read(COMPONENT);
    expect(source).toContain("clampReferenceSelection(rawSelection, limit)");
    expect(source).toMatch(/reportedClamp/);
    expect(source).toMatch(/commitSelection\(selection\)/);
  });
});

describe("mobile (~390px) — the properties that make it work", () => {
  const source = () => read(COMPONENT);

  it("stacks the thumbnail grid to ONE column at base", () => {
    // Base classes ARE the mobile styles in this codebase; desktop is layered
    // on at sm:/lg:. A grid that starts at two columns puts a 390px viewport
    // into horizontal scroll.
    expect(source()).toMatch(/grid-cols-1[^"]*sm:grid-cols-2/);
    expect(source(), "no base-level multi-column grid anywhere").not.toMatch(
      /className="[^"]*(?<!:)grid-cols-[2-9]/
    );
  });

  it("gives every interactive control a >=44px tap target", () => {
    // Counted over STRIPPED source: the file field, the label field, the submit
    // button, the reference card, and the unlisted-selection stub. Deleting
    // `min-h-11` from any one of them now reddens, which it did not when the
    // docblock's prose was padding the count.
    const controls = source().match(/min-h-11/g)?.length ?? 0;
    expect(controls).toBeGreaterThanOrEqual(5);
  });

  it("renders the selection count as TEXT, never as a hover-only affordance", () => {
    // There is no hover on a phone, and the count is the one thing that
    // explains why the next tap did nothing.
    expect(source()).toContain("IMAGE_LAB_REFERENCE_COPY.selectionCounter(selection.length, limit)");
    expect(source()).not.toMatch(/title=\{[^}]*selectionCounter/);
    expect(source()).not.toMatch(/(hover|group-hover):[^"]*\bopacity-100\b/);
  });

  it("marks selection state for assistive tech, not by colour alone", () => {
    expect(source()).toContain("aria-pressed={picked}");
  });
});

describe("the picker never holds a raw storage key", () => {
  it("renders thumbnails from the signed URL only", () => {
    const source = read(COMPONENT);
    expect(source).toContain("reference.signedUrl");
    expect(source).not.toContain("reference.storageKey");
    // …except where it hands the freshly minted slot's key straight back to the
    // upload leg and to registration, which is the only key a client ever sees
    // and only for the duration of its own upload.
    expect(source.match(/slot\.storageKey/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
