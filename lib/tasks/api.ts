import { logger } from "@/lib/logger";
import type { CreateResult, CreateTaskInput, ListResult, Task } from "@/lib/tasks/types";

type Op = "list" | "create";
type Reason = "unconfigured" | "network" | "timeout" | "status" | "body";

function fail(op: Op, reason: Reason, status?: number): void {
  logger.warn("task api call failed", { op, ...(status !== undefined ? { status } : {}), reason });
}

function baseUrl(): string | null {
  const raw = process.env.TASK_API_URL;
  if (!raw) {
    logger.error("TASK_API_URL is not set");
    return null;
  }
  return raw.replace(/\/+$/, "");
}

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    (typeof v.due_date === "string" || v.due_date === null)
  );
}

function pickTask(v: Task): Task {
  return { id: v.id, title: v.title, due_date: v.due_date };
}

async function call(
  op: Op,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch (err) {
    fail(op, err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network");
    return null;
  }
}

async function readJson(op: Op, res: Response): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await res.json() };
  } catch (err) {
    fail(op, err instanceof Error && err.name === "TimeoutError" ? "timeout" : "body", res.status);
    return { ok: false };
  }
}

export async function listTasks(): Promise<ListResult> {
  const base = baseUrl();
  if (base === null) {
    fail("list", "unconfigured");
    return { ok: false };
  }
  const res = await call("list", `${base}/tasks`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!res) return { ok: false };
  if (res.status !== 200) {
    fail("list", "status", res.status);
    return { ok: false };
  }
  const parsed = await readJson("list", res);
  if (!parsed.ok) return { ok: false };
  if (!Array.isArray(parsed.body) || !parsed.body.every(isTask)) {
    fail("list", "body", res.status);
    return { ok: false };
  }
  return { ok: true, tasks: parsed.body.map(pickTask) };
}

function titleIssue(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return false;
  return detail.some((d: unknown) => {
    if (typeof d !== "object" || d === null) return false;
    const loc = (d as { loc?: unknown }).loc;
    return Array.isArray(loc) && loc.length > 0 && loc[loc.length - 1] === "title";
  });
}

export async function createTask(input: CreateTaskInput): Promise<CreateResult> {
  const base = baseUrl();
  if (base === null) {
    fail("create", "unconfigured");
    return { kind: "failed" };
  }
  const res = await call("create", `${base}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ title: input.title, due_date: input.due_date }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res) return { kind: "failed" };
  if (res.status !== 201 && res.status !== 422) {
    fail("create", "status", res.status);
    return { kind: "failed" };
  }
  const parsed = await readJson("create", res);
  if (!parsed.ok) return { kind: "failed" };
  if (res.status === 201) {
    if (isTask(parsed.body)) return { kind: "created", task: pickTask(parsed.body) };
    fail("create", "body", res.status);
    return { kind: "failed" };
  }
  if (titleIssue(parsed.body)) return { kind: "invalid-title" };
  fail("create", "status", res.status);
  return { kind: "failed" };
}
