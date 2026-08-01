import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import {
  dailySprintKeys,
  dailySprintProblem,
  officialSprintElapsed,
  SPRINT_LENGTH,
  SPRINT_SECONDS,
  sprintScore,
  type SprintAnswer,
  type SprintBoardRow,
  type SprintBracket,
  type SprintStanding,
} from "@/app/gauntlet/game/dailySprint";
import { judgeAnswer } from "@/app/gauntlet/game/problems";

const VALID_BANDS: readonly SprintBracket[] = [
  "g34",
  "g56",
  "g78",
  "g910",
  "g11",
  "g12",
];
const configured = () =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const todayUtc = () => new Date().toISOString().slice(0, 10);
const validDate = (value: string | null): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
const validAttemptId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

type SprintDbRow = {
  handle: string;
  sprint_date: string;
  band: SprintBracket;
  correct: number;
  wrong: number;
  elapsed_ms: number;
  score: number;
  status?: "started" | "completed";
};

class SprintDataError extends Error {
  constructor(
    readonly stage: string,
    readonly code?: string
  ) {
    super(`Daily Sprint data failure at ${stage}`);
  }
}

function failData(stage: string, error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : undefined;
  throw new SprintDataError(stage, code);
}

function logSprintFailure(
  operation: string,
  error: unknown,
  context: { date?: string | null; band?: SprintBracket | null } = {}
) {
  const dataError = error instanceof SprintDataError ? error : null;
  console.error("[gauntlet.daily-sprint] request failed", {
    operation,
    stage: dataError?.stage ?? "unexpected",
    code: dataError?.code,
    date: context.date,
    band: context.band,
  });
}

const previousUtcDate = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

function mapBoardRow(row: SprintDbRow, rank: number): SprintBoardRow {
  return {
    rank,
    handle: row.handle,
    date: row.sprint_date,
    band: row.band,
    correct: row.correct,
    wrong: row.wrong,
    elapsedMs: row.elapsed_ms,
    score: row.score,
  };
}

async function boardRows(date: string, band: SprintBracket) {
  const { data, error } = await supabaseAdmin()
    .from("gauntlet_daily_sprints")
    .select("handle,sprint_date,band,correct,wrong,elapsed_ms,score")
    .eq("sprint_date", date)
    .eq("band", band)
    .eq("status", "completed")
    .order("score", { ascending: false })
    .order("elapsed_ms", { ascending: true })
    .limit(100);
  if (error) failData("board-read", error);
  return (data ?? []).map((row, index) => mapBoardRow(row as SprintDbRow, index + 1));
}

async function rankForRow(row: SprintDbRow): Promise<number> {
  const db = supabaseAdmin();
  const base = () =>
    db
      .from("gauntlet_daily_sprints")
      .select("user_id", { count: "exact", head: true })
      .eq("sprint_date", row.sprint_date)
      .eq("band", row.band)
      .eq("status", "completed");
  const [better, tiedFaster] = await Promise.all([
    base().gt("score", row.score),
    base().eq("score", row.score).lt("elapsed_ms", row.elapsed_ms),
  ]);
  if (better.error) failData("standing-rank-better", better.error);
  if (tiedFaster.error) failData("standing-rank-tie", tiedFaster.error);
  return 1 + (better.count ?? 0) + (tiedFaster.count ?? 0);
}

async function previousRankForUser(
  userId: string,
  date: string,
  band: SprintBracket
): Promise<number | undefined> {
  const { data, error } = await supabaseAdmin()
    .from("gauntlet_daily_sprints")
    .select("handle,sprint_date,band,correct,wrong,elapsed_ms,score,status")
    .eq("user_id", userId)
    .eq("sprint_date", previousUtcDate(date))
    .eq("band", band)
    .eq("status", "completed")
    .maybeSingle();
  if (error) failData("previous-standing-read", error);
  return data ? rankForRow(data as SprintDbRow) : undefined;
}

async function standingForUser(
  userId: string,
  date: string,
  band: SprintBracket
): Promise<{ attemptUsed: boolean; standing?: SprintStanding }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("gauntlet_daily_sprints")
    .select("handle,sprint_date,band,correct,wrong,elapsed_ms,score,status")
    .eq("user_id", userId)
    .eq("sprint_date", date)
    .eq("band", band)
    .maybeSingle();
  if (error) failData("own-standing-read", error);
  if (!data) return { attemptUsed: false };
  if (data.status !== "completed") return { attemptUsed: true };

  const own = data as SprintDbRow;
  const [rank, tiedAheadResult, higherAheadResult, previousRank] = await Promise.all([
    rankForRow(own),
    db
      .from("gauntlet_daily_sprints")
      .select("handle,sprint_date,band,correct,wrong,elapsed_ms,score")
      .eq("sprint_date", date)
      .eq("band", band)
      .eq("status", "completed")
      .eq("score", own.score)
      .lt("elapsed_ms", own.elapsed_ms)
      .order("elapsed_ms", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("gauntlet_daily_sprints")
      .select("handle,sprint_date,band,correct,wrong,elapsed_ms,score")
      .eq("sprint_date", date)
      .eq("band", band)
      .eq("status", "completed")
      .gt("score", own.score)
      .order("score", { ascending: true })
      .order("elapsed_ms", { ascending: false })
      .limit(1)
      .maybeSingle(),
    previousRankForUser(userId, date, band),
  ]);
  if (tiedAheadResult.error) failData("standing-target-tie", tiedAheadResult.error);
  if (higherAheadResult.error) failData("standing-target-higher", higherAheadResult.error);
  const aheadData = tiedAheadResult.data ?? higherAheadResult.data;
  return {
    attemptUsed: true,
    standing: {
      me: mapBoardRow(own, rank),
      ahead: aheadData
        ? mapBoardRow(aheadData as SprintDbRow, Math.max(1, rank - 1))
        : null,
      previousRank,
    },
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const band = url.searchParams.get("band") as SprintBracket | null;
  if (!validDate(date) || !band || !VALID_BANDS.includes(band)) {
    return NextResponse.json(
      { rows: [], attemptUsed: false, available: false },
      { status: 400 }
    );
  }
  if (!configured()) {
    logSprintFailure("get", new SprintDataError("configuration"), { date, band });
    return NextResponse.json(
      { rows: [], attemptUsed: false, available: false },
      { status: 503 }
    );
  }

  try {
    const rows = await boardRows(date, band);
    let attemptUsed = false;
    let standing: SprintStanding | undefined;
    if (url.searchParams.get("mine") === "1") {
      const auth = await supabaseServer();
      const {
        data: { user },
      } = await auth.auth.getUser();
      if (user) {
        const own = await standingForUser(user.id, date, band);
        attemptUsed = own.attemptUsed;
        standing = own.standing;
      }
    }
    return NextResponse.json({ rows, attemptUsed, standing, available: true });
  } catch (error) {
    logSprintFailure("get", error, { date, band });
    return NextResponse.json(
      { rows: [], attemptUsed: false, available: false },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  if (!configured()) {
    logSprintFailure("post", new SprintDataError("configuration"));
    return NextResponse.json(
      { reserved: false, posted: false, reason: "unavailable", rows: [], available: false },
      { status: 503 }
    );
  }

  try {
    const auth = await supabaseServer();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { reserved: false, posted: false, reason: "sign_in_required" },
        { status: 401 }
      );
    }

    const raw = (await request.json()) as {
      action?: unknown;
      date?: unknown;
      band?: unknown;
      handle?: unknown;
      attemptId?: unknown;
      answers?: unknown;
    };
    const action = raw.action === "start" || raw.action === "complete" ? raw.action : null;
    const date = typeof raw.date === "string" ? raw.date : "";
    const band = typeof raw.band === "string" ? (raw.band as SprintBracket) : null;
    if (
      !action ||
      date !== todayUtc() ||
      !band ||
      !VALID_BANDS.includes(band)
    ) {
      return NextResponse.json({ error: "Bad sprint." }, { status: 400 });
    }

    const db = supabaseAdmin();
    if (action === "start") {
      const handle =
        typeof raw.handle === "string"
          ? raw.handle.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12)
          : "";
      if (!handle) {
        return NextResponse.json(
          { reserved: false, reason: "sign_in_required" },
          { status: 400 }
        );
      }

      const attemptId = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await db.from("gauntlet_daily_sprints").insert({
        user_id: user.id,
        sprint_date: date,
        band,
        attempt_id: attemptId,
        status: "started",
        handle,
        correct: 0,
        wrong: 0,
        elapsed_ms: SPRINT_SECONDS * 1000,
        score: sprintScore(0, 0, SPRINT_SECONDS * 1000),
        updated_at: now,
      });
      if (!error) {
        return NextResponse.json({ reserved: true, attemptId, available: true });
      }
      if (error.code === "23505") {
        return NextResponse.json({
          reserved: false,
          reason: "ranked_attempt_used",
          rows: await boardRows(date, band),
          available: true,
        });
      }
      failData("attempt-reserve", error);
    }

    if (
      !validAttemptId(raw.attemptId) ||
      !Array.isArray(raw.answers) ||
      raw.answers.length > SPRINT_LENGTH
    ) {
      return NextResponse.json({ error: "Bad sprint." }, { status: 400 });
    }

    const { data: attempt, error: attemptError } = await db
      .from("gauntlet_daily_sprints")
      .select("attempt_id,status,created_at")
      .eq("user_id", user.id)
      .eq("sprint_date", date)
      .eq("band", band)
      .maybeSingle();
    if (attemptError) failData("attempt-read", attemptError);
    if (
      !attempt ||
      attempt.status !== "started" ||
      attempt.attempt_id !== raw.attemptId
    ) {
      return NextResponse.json({
        posted: false,
        reason: "ranked_attempt_used",
        rows: await boardRows(date, band),
        available: true,
      });
    }

    const deck = dailySprintKeys(date, band);
    const answers = raw.answers as SprintAnswer[];
    let correct = 0;
    let wrong = 0;
    let answerMs = 0;
    for (let i = 0; i < answers.length; i++) {
      const answer = answers[i];
      const expectedKey = deck[i];
      if (
        !answer ||
        typeof answer.key !== "string" ||
        answer.key !== expectedKey ||
        typeof answer.response !== "string" ||
        !Number.isFinite(answer.ms)
      ) {
        return NextResponse.json({ error: "Bad sprint." }, { status: 400 });
      }
      const problem = dailySprintProblem(expectedKey);
      if (!problem) {
        return NextResponse.json({ error: "Bad sprint." }, { status: 400 });
      }
      if (judgeAnswer(problem, answer.response)) correct++;
      else wrong++;
      answerMs += Math.max(250, Math.min(30_000, Math.round(answer.ms)));
    }

    const completedAt = new Date();
    const elapsedMs = officialSprintElapsed(
      answerMs,
      Date.parse(attempt.created_at),
      completedAt.getTime(),
      answers.length >= deck.length
    );
    const score = sprintScore(correct, wrong, elapsedMs);
    const { data: completed, error } = await db
      .from("gauntlet_daily_sprints")
      .update({
        status: "completed",
        correct,
        wrong,
        elapsed_ms: elapsedMs,
        score,
        completed_at: completedAt.toISOString(),
        updated_at: completedAt.toISOString(),
      })
      .eq("user_id", user.id)
      .eq("sprint_date", date)
      .eq("band", band)
      .eq("attempt_id", raw.attemptId)
      .eq("status", "started")
      .select("attempt_id")
      .maybeSingle();
    if (error || !completed) {
      failData("attempt-complete", error ?? new Error("completion row missing"));
    }

    const own = await standingForUser(user.id, date, band);

    return NextResponse.json({
      posted: true,
      official: { correct, wrong, elapsedMs, score },
      rows: await boardRows(date, band),
      standing: own.standing,
      attemptUsed: own.attemptUsed,
      available: true,
    });
  } catch (error) {
    logSprintFailure("post", error);
    return NextResponse.json(
      { reserved: false, posted: false, reason: "unavailable", rows: [], available: false },
      { status: 503 }
    );
  }
}
