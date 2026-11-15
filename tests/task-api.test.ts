import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTaskAction } from "@/app/actions/tasks";
import { createTask, listTasks } from "@/lib/tasks/api";
import { validateTitle } from "@/lib/tasks/validation";

import { deadUrl, startFakeApi, type FakeApi, type FakeReply, type RecordedRequest } from "./fake-task-api";

let api: FakeApi | undefined;
const original = process.env.TASK_API_URL;

async function serve(handler: (r: RecordedRequest) => FakeReply) {
  api = await startFakeApi(handler);
  process.env.TASK_API_URL = api.url;
  return api;
}

beforeEach(() => {
  delete process.env.TASK_API_URL;
});

afterEach(async () => {
  await api?.close();
  api = undefined;
  if (original === undefined) delete process.env.TASK_API_URL;
  else process.env.TASK_API_URL = original;
});

const A = { id: "1", title: "  A  ", due_date: "2026-12-01" };
const B = { id: "2", title: "B", due_date: null };
const C = { id: "3", title: "C", due_date: "2027-01-31" };

describe("listTasks", () => {
  it("AC-001.1 returns the tasks in the API's order with values untouched", async () => {
    const fake = await serve(() => ({ status: 200, json: [A, B, C] }));
    const r = await listTasks();
    expect(r).toEqual({ ok: true, tasks: [A, B, C] });
    expect(fake.requests[0]).toMatchObject({ method: "GET", url: "/tasks" });
  });

  it("AC-001.1 accepts a trailing slash on TASK_API_URL", async () => {
    const fake = await serve(() => ({ status: 200, json: [] }));
    process.env.TASK_API_URL = `${fake.url}/`;
    expect(await listTasks()).toEqual({ ok: true, tasks: [] });
    expect(fake.requests[0].url).toBe("/tasks");
  });

  it("AC-001.2 treats an empty array as an empty list", async () => {
    await serve(() => ({ status: 200, json: [] }));
    expect(await listTasks()).toEqual({ ok: true, tasks: [] });
  });

  it("AC-001.6 fails when the API is unreachable", async () => {
    process.env.TASK_API_URL = await deadUrl();
    expect(await listTasks()).toEqual({ ok: false });
  });

  it("AC-001.6 fails when TASK_API_URL is unset", async () => {
    expect(await listTasks()).toEqual({ ok: false });
  });

  it.each([503, 500, 404])("AC-001.6 fails on status %i", async (status) => {
    await serve(() => ({ status, json: { detail: "Task store unavailable" } }));
    expect(await listTasks()).toEqual({ ok: false });
  });

  it("AC-001.6 fails on a non-JSON body", async () => {
    await serve(() => ({ status: 200, text: "<html>hi</html>" }));
    expect(await listTasks()).toEqual({ ok: false });
  });

  it("AC-001.6 fails on a non-array body", async () => {
    await serve(() => ({ status: 200, json: { tasks: [] } }));
    expect(await listTasks()).toEqual({ ok: false });
  });

  it("AC-001.6 fails on a malformed element", async () => {
    await serve(() => ({ status: 200, json: [A, { id: "x", title: 5, due_date: null }] }));
    expect(await listTasks()).toEqual({ ok: false });
  });

  it("AC-001.6 fails when the API does not answer within 3 seconds", async () => {
    await serve(() => ({ hang: true }));
    const started = Date.now();
    expect(await listTasks()).toEqual({ ok: false });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(2500);
    expect(took).toBeLessThan(4500);
  }, 8000);
});

describe("createTask", () => {
  it("AC-001.3 posts exactly title and due_date as JSON and returns the API's task", async () => {
    const fake = await serve(() => ({ status: 201, json: { id: "9", title: "Call Bob", due_date: "2026-12-24" } }));
    const r = await createTask({ title: "Call Bob", due_date: "2026-12-24" });
    expect(r).toEqual({ kind: "created", task: { id: "9", title: "Call Bob", due_date: "2026-12-24" } });
    const req = fake.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/tasks");
    expect(req.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(req.body)).toEqual({ title: "Call Bob", due_date: "2026-12-24" });
  });

  it("AC-001.3 sends due_date null, not omitted, when there is none", async () => {
    const fake = await serve(() => ({ status: 201, json: { id: "9", title: "Call Bob", due_date: null } }));
    await createTask({ title: "Call Bob", due_date: null });
    const body = JSON.parse(fake.requests[0].body) as Record<string, unknown>;
    expect(body).toHaveProperty("due_date", null);
    expect(body.title).toBe("Call Bob");
  });

  it("AC-001.5 classifies a 422 whose loc ends in title as invalid-title", async () => {
    await serve(() => ({
      status: 422,
      json: { detail: [{ type: "x", loc: ["body", "title"], msg: "m", input: "" }] },
    }));
    expect(await createTask({ title: "", due_date: null })).toEqual({ kind: "invalid-title" });
  });

  it("AC-001.7 classifies a 422 naming only due_date as failed", async () => {
    await serve(() => ({
      status: 422,
      json: { detail: [{ type: "x", loc: ["body", "due_date"], msg: "m", input: "z" }] },
    }));
    expect(await createTask({ title: "ok", due_date: "bad" })).toEqual({ kind: "failed" });
  });

  it.each([503, 500, 400])("AC-001.7 classifies status %i as failed", async (status) => {
    await serve(() => ({ status, json: { detail: "nope" } }));
    expect(await createTask({ title: "ok", due_date: null })).toEqual({ kind: "failed" });
  });

  it("AC-001.7 classifies a 201 with a malformed body as failed", async () => {
    await serve(() => ({ status: 201, json: { id: 1 } }));
    expect(await createTask({ title: "ok", due_date: null })).toEqual({ kind: "failed" });
  });

  it("AC-001.7 classifies an unreachable API as failed", async () => {
    process.env.TASK_API_URL = await deadUrl();
    expect(await createTask({ title: "ok", due_date: null })).toEqual({ kind: "failed" });
  });

  it("AC-001.7 classifies an unset TASK_API_URL as failed", async () => {
    expect(await createTask({ title: "ok", due_date: null })).toEqual({ kind: "failed" });
  });

  it("AC-001.7 fails when the API does not answer within 5 seconds, without retrying", async () => {
    const fake = await serve(() => ({ hang: true }));
    const started = Date.now();
    expect(await createTask({ title: "ok", due_date: null })).toEqual({ kind: "failed" });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(4500);
    expect(took).toBeLessThan(6500);
    expect(fake.requests).toHaveLength(1);
  }, 10000);
});

describe("validateTitle", () => {
  it("AC-001.4 rejects empty and whitespace-only titles as required", () => {
    expect(validateTitle("")).toBe("Title is required");
    expect(validateTitle("   \t\n")).toBe("Title is required");
  });

  it("AC-001.4 rejects more than 200 characters as too long and accepts exactly 200", () => {
    expect(validateTitle("a".repeat(201))).toBe("Title must be at most 200 characters");
    expect(validateTitle("a".repeat(200))).toBeNull();
  });

  it("AC-001.4 counts code points, not UTF-16 units", () => {
    expect(validateTitle("😀".repeat(150))).toBeNull();
    expect(validateTitle("😀".repeat(201))).toBe("Title must be at most 200 characters");
  });

  it("AC-001.3 accepts a normal title", () => {
    expect(validateTitle("Call Bob")).toBeNull();
  });
});

describe("createTaskAction", () => {
  it("AC-001.3 creates through the API and returns the created task", async () => {
    const fake = await serve(() => ({ status: 201, json: { id: "7", title: "Call Bob", due_date: null } }));
    const r = await createTaskAction({ title: "Call Bob", due_date: "" });
    expect(r).toEqual({ status: "created", task: { id: "7", title: "Call Bob", due_date: null } });
    expect(JSON.parse(fake.requests[0].body)).toEqual({ title: "Call Bob", due_date: null });
  });

  it.each([
    ["", "Title is required"],
    ["   ", "Title is required"],
    ["a".repeat(201), "Title must be at most 200 characters"],
  ])("AC-001.4 rejects an invalid title (%#) without calling the API", async (title, titleError) => {
    const fake = await serve(() => ({ status: 201, json: A }));
    expect(await createTaskAction({ title, due_date: null })).toEqual({ status: "invalid", titleError });
    expect(fake.requests).toHaveLength(0);
  });

  it("AC-001.5 maps an API title 422 to Title is required for a short title", async () => {
    await serve(() => ({ status: 422, json: { detail: [{ type: "x", loc: ["body", "title"], msg: "m", input: "" }] } }));
    expect(await createTaskAction({ title: "short", due_date: null })).toEqual({
      status: "invalid",
      titleError: "Title is required",
    });
  });

  it("AC-001.5 answers too long for a title over 200 characters, whichever side rejects it", async () => {
    await serve(() => ({ status: 422, json: { detail: [{ type: "x", loc: ["body", "title"], msg: "m", input: "" }] } }));
    expect(await createTaskAction({ title: "b".repeat(250), due_date: null })).toEqual({
      status: "invalid",
      titleError: "Title must be at most 200 characters",
    });
  });

  it("AC-001.7 returns failed on 503", async () => {
    await serve(() => ({ status: 503, json: { detail: "Task store unavailable" } }));
    expect(await createTaskAction({ title: "ok", due_date: null })).toEqual({ status: "failed" });
  });

  it("AC-001.7 returns failed when the API is unreachable", async () => {
    process.env.TASK_API_URL = await deadUrl();
    expect(await createTaskAction({ title: "ok", due_date: null })).toEqual({ status: "failed" });
  });
});
