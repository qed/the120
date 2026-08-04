/**
 * Shared roster loader for the First Profit beta cohort scripts.
 *
 * The roster is REAL FAMILY DATA — parent names and addresses, children's
 * first names and ages — so it does not live in this repository, which is
 * public. It lives beside the credentials file it pairs with:
 *
 *   scripts/.fp-cohort-roster.local.json   (gitignored, local only)
 *
 * Shape (an array of families):
 *
 *   [
 *     { "firstName": "Ada", "lastName": "Byron", "email": "ada@example.com",
 *       "existingAccount": false,
 *       "children": [{ "firstName": "Kid", "lastName": "Byron", "age": 11 }] }
 *   ]
 *
 * `existingAccount` marks a family that already held a The120 account before
 * provisioning — they get email variant B (no parent password) rather than A.
 *
 * Exits loudly when the file is absent or malformed: every consumer either
 * writes to production or reports on it, and a silently-empty roster would
 * verify green against nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const ROSTER_PATH = "scripts/.fp-cohort-roster.local.json";

export type RosterChild = { firstName: string; lastName: string; age: number };
export type RosterFamily = {
  firstName: string;
  lastName: string;
  email: string;
  existingAccount?: boolean;
  children: RosterChild[];
};

/** The child's First Profit login, derived — never stored in the roster. */
export const usernameFor = (c: RosterChild) => `${c.firstName.toLowerCase()}@firstprofit.school`;

/** Grade and birth year are derived from age, as the provisioner always did. */
export const gradeFor = (c: RosterChild) => c.age - 5;
export const birthYearFor = (c: RosterChild, schoolYearStart: number) =>
  String(schoolYearStart - c.age);

export function loadRoster(): RosterFamily[] {
  const file = path.resolve(process.cwd(), ROSTER_PATH);
  if (!existsSync(file)) {
    console.error(
      `Missing ${ROSTER_PATH}.\n` +
        "The cohort roster is real family data and is deliberately not committed.\n" +
        "Restore it from your local copy (it pairs with scripts/.fp-cohort-credentials.local.md)."
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`${ROSTER_PATH} is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error(`${ROSTER_PATH} must be a non-empty array of families.`);
    process.exit(1);
  }

  for (const [i, fam] of parsed.entries()) {
    const ok =
      fam && typeof fam.firstName === "string" && typeof fam.lastName === "string" &&
      typeof fam.email === "string" && Array.isArray(fam.children) && fam.children.length > 0 &&
      fam.children.every(
        (c: RosterChild) =>
          c && typeof c.firstName === "string" && typeof c.lastName === "string" &&
          Number.isInteger(c.age)
      );
    if (!ok) {
      console.error(`${ROSTER_PATH}: family at index ${i} is missing required fields.`);
      process.exit(1);
    }
  }

  return parsed as RosterFamily[];
}
