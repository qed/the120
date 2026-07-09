/**
 * Dashboard + dossier data model (brief §13.3–13.5).
 * V1 is local (localStorage); this shape mirrors the future Supabase tables:
 *   parents → children → subject_picks / workshop_selections / project_pitch → dossier(status)
 */

export type SeatStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "invited"
  | "offered"
  | "member";

export const STATUS_FLOW: { id: SeatStatus; label: string; short: string }[] = [
  { id: "draft", label: "Draft", short: "Building the dossier" },
  { id: "submitted", label: "Submitted", short: "Sent for review" },
  { id: "in_review", label: "In review", short: "The 120 team is reviewing" },
  { id: "invited", label: "Invited to assessment", short: "Assessment + call scheduled" },
  { id: "offered", label: "Offered a seat", short: "A seat is offered" },
  { id: "member", label: "Member of the 120", short: "Welcome to the network" },
];

export const statusIndex = (s: SeatStatus) => STATUS_FLOW.findIndex((x) => x.id === s);
export const statusMeta = (s: SeatStatus) => STATUS_FLOW[statusIndex(s)];

export const GRADES = [3, 4, 5, 6, 7, 8] as const;
export const SUBJECTS = ["Math", "Reading", "Writing", "Science", "History"] as const;

/** Native workshop catalog (brief §13.3.3). Real GT catalog sync is an Open Item — mocked for V1. */
export type Workshop = {
  id: string;
  title: string;
  advisor: string;
  track: string;
  grades: string;
  length: string;
  description: string;
};

export const WORKSHOPS: Workshop[] = [
  {
    id: "ws-robotics",
    title: "Competitive Robotics",
    advisor: "Dr. Elena Marsh",
    track: "Engineering",
    grades: "5–8",
    length: "90 min / week",
    description: "Design, build, and program robots for real competition. Ships to a demo at the intensives.",
  },
  {
    id: "ws-olympiad",
    title: "Science Olympiad Lab",
    advisor: "Dr. Priya Nair",
    track: "Science",
    grades: "4–8",
    length: "75 min / week",
    description: "Olympiad-level experiments and problem sets across biology, chemistry, and physics.",
  },
  {
    id: "ws-philosophy",
    title: "Philosophy for Young Minds",
    advisor: "Prof. Daniel Okoye",
    track: "Humanities",
    grades: "5–8",
    length: "60 min / week",
    description: "Socratic seminars on the big questions — ethics, logic, and what it means to know.",
  },
  {
    id: "ws-writers",
    title: "The Writers' Room",
    advisor: "Ms. Clara Benson",
    track: "Writing",
    grades: "3–7",
    length: "60 min / week",
    description: "Draft, workshop, and publish original fiction and essays with a working author.",
  },
  {
    id: "ws-math",
    title: "Math Circle: Proofs & Puzzles",
    advisor: "Dr. Wei Zhang",
    track: "Math",
    grades: "4–8",
    length: "75 min / week",
    description: "Competition-math thinking — number theory, combinatorics, and elegant proofs.",
  },
  {
    id: "ws-startup",
    title: "Founders Lab",
    advisor: "Mr. Aaron Fields",
    track: "Entrepreneurship",
    grades: "6–8",
    length: "90 min / week",
    description: "Take an idea from pitch to prototype to a live demo at the Capstone Arena.",
  },
  {
    id: "ws-ai",
    title: "Intro to AI & Machine Learning",
    advisor: "Dr. Sofia Ramirez",
    track: "Computer Science",
    grades: "6–8",
    length: "90 min / week",
    description: "Build and train simple models; understand how modern AI actually works.",
  },
  {
    id: "ws-debate",
    title: "Debate & Rhetoric",
    advisor: "Ms. Hannah Lee",
    track: "Humanities",
    grades: "5–8",
    length: "60 min / week",
    description: "Argue, rebut, and think on your feet in a competitive debate format.",
  },
];

export const workshopById = (id: string) => WORKSHOPS.find((w) => w.id === id);

export type Child = {
  id: string;
  // Basics
  firstName: string;
  lastName: string;
  grade: number | "";
  birthYear: string;
  currentSchool: string;
  photo?: string; // data URL (V1); real uploads → Supabase storage (V2)
  // Academic picks (1–2 subjects) + optional shared scores
  subjects: string[];
  testScores: string;
  // Workshop selections
  workshopIds: string[];
  // Project pitch & interests
  interests: string;
  projectPitch: string;
  portfolioLinks: string;
  // Dossier status
  status: SeatStatus;
  submittedAt?: string;
};

export type Parent = {
  firstName: string;
  lastName: string;
  email: string;
};

export type DashboardState = {
  parent: Parent | null;
  children: Child[];
};

export function emptyChild(id: string): Child {
  return {
    id,
    firstName: "",
    lastName: "",
    grade: "",
    birthYear: "",
    currentSchool: "",
    subjects: [],
    testScores: "",
    workshopIds: [],
    interests: "",
    projectPitch: "",
    portfolioLinks: "",
    status: "draft",
  };
}

/** Dossier checklist drives the per-child completeness meter (§13.3.2). */
export function checklist(c: Child): { label: string; done: boolean }[] {
  return [
    { label: "Name", done: !!c.firstName.trim() && !!c.lastName.trim() },
    { label: "Grade", done: c.grade !== "" },
    { label: "Birth year", done: /^\d{4}$/.test(c.birthYear.trim()) },
    { label: "Current school", done: !!c.currentSchool.trim() },
    { label: "1–2 subjects to accelerate", done: c.subjects.length >= 1 },
    { label: "A workshop of interest", done: c.workshopIds.length >= 1 },
    { label: "The kid's interests", done: c.interests.trim().length >= 3 },
    { label: "A project pitch", done: c.projectPitch.trim().length >= 10 },
  ];
}

export function completeness(c: Child): number {
  const items = checklist(c);
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

export function childName(c: Child): string {
  const n = `${c.firstName} ${c.lastName}`.trim();
  return n || "New child";
}
