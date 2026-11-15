import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoard } from "@/app/_components/task-board";
import Page from "@/app/page";
import type { ActionResult, CreateTaskInput, ListResult, Task } from "@/lib/tasks/types";

import { deadUrl, startFakeApi, type FakeApi, type FakeReply, type RecordedRequest } from "./fake-task-api";

const A: Task = { id: "1", title: "Alpha", due_date: "2026-12-01" };
const B: Task = { id: "2", title: "  Beta  two ", due_date: null };
const C: Task = { id: "3", title: "Gamma", due_date: "2027-01-31" };

const TOO_LONG = "Title must be at most 200 characters";
const REQUIRED = "Title is required";
const LOAD_FAILED = "Tasks could not be loaded. Try again later.";
const SAVE_FAILED = "Task could not be saved. Try again.";

function noopAction() {
  return vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => ({ status: "failed" }));
}

function renderBoard(initial: ListResult, createTask = noopAction()) {
  render(<TaskBoard initial={initial} createTask={createTask} />);
  return createTask;
}

function titleInput() {
  return screen.getByLabelText("Title") as HTMLInputElement;
}
function dateInput() {
  return screen.getByLabelText("Due date") as HTMLInputElement;
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
}
function type(value: string, date?: string) {
  fireEvent.change(titleInput(), { target: { value } });
  if (date !== undefined) fireEvent.change(dateInput(), { target: { value: date } });
}

describe("TaskBoard list", () => {
  it("AC-001.1 lists the tasks in order with exact titles and due dates", () => {
    renderBoard({ ok: true, tasks: [A, B, C] });
    const items = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Alpha")).toBeInTheDocument();
    expect(within(items[0]).getByText("2026-12-01")).toBeInTheDocument();
    expect(within(items[1]).getByText(B.title, { normalizer: (s) => s })).toBeInTheDocument();
    expect(within(items[1]).getByText("No due date")).toBeInTheDocument();
    expect(within(items[2]).getByText("Gamma")).toBeInTheDocument();
    expect(within(items[2]).getByText("2027-01-31")).toBeInTheDocument();
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
  });

  it("AC-001.1 shows one h1 Task board", () => {
    renderBoard({ ok: true, tasks: [A] });
    expect(screen.getByRole("heading", { level: 1, name: "Task board" })).toBeInTheDocument();
  });

  it("AC-001.2 shows No tasks yet and the form with a title field and a date input", () => {
    renderBoard({ ok: true, tasks: [] });
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Add task" });
    expect(within(form).getByLabelText("Title")).toHaveAttribute("type", "text");
    expect(within(form).getByLabelText("Due date")).toHaveAttribute("type", "date");
    expect(within(form).getByRole("button", { name: "Add task" })).toBeInTheDocument();
  });

  it("AC-001.6 shows the load failure instead of the list, with the form still shown", () => {
    renderBoard({ ok: false });
    expect(screen.getByRole("alert")).toHaveTextContent(LOAD_FAILED);
    expect(screen.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add task" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
  });
});

describe("TaskBoard create", () => {
  it("AC-001.3 sends the input, appends the returned task and empties the form", async () => {
    const created: Task = { id: "9", title: "Call Bob", due_date: "2026-12-24" };
    const action = vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => ({
      status: "created",
      task: created,
    }));
    renderBoard({ ok: true, tasks: [A] }, action);
    type("Call Bob", "2026-12-24");
    submit();
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem")).toHaveLength(2));
    expect(action).toHaveBeenCalledWith({ title: "Call Bob", due_date: "2026-12-24" });
    const items = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(within(items[0]).getByText("Alpha")).toBeInTheDocument();
    expect(within(items[1]).getByText("Call Bob")).toBeInTheDocument();
    expect(within(items[1]).getByText("2026-12-24")).toBeInTheDocument();
    await waitFor(() => expect(titleInput().value).toBe(""));
    expect(dateInput().value).toBe("");
  });

  it("AC-001.3 sends due_date null when no date was picked and replaces the empty text with the list", async () => {
    const created: Task = { id: "9", title: "Call Bob", due_date: null };
    const action = vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => ({ status: "created", task: created }));
    renderBoard({ ok: true, tasks: [] }, action);
    type("Call Bob");
    submit();
    await screen.findByRole("list", { name: "Tasks" });
    expect(action).toHaveBeenCalledWith({ title: "Call Bob", due_date: null });
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
    expect(screen.getByText("No due date")).toBeInTheDocument();
  });
});

describe("TaskBoard title validation", () => {
  it.each([
    ["empty", "", REQUIRED],
    ["whitespace-only", "   ", REQUIRED],
    ["over 200 characters", "x".repeat(201), TOO_LONG],
  ])("AC-001.4 %s title shows its text next to the field, keeps input and sends nothing", (_n, value, text) => {
    const action = renderBoard({ ok: true, tasks: [] });
    type(value, "2026-05-05");
    submit();
    const alert = screen.getByText(text);
    expect(alert).toBeInTheDocument();
    expect(titleInput()).toHaveAttribute("aria-invalid", "true");
    expect(titleInput().getAttribute("aria-describedby")).toBe(alert.id);
    expect(titleInput().value).toBe(value);
    expect(dateInput().value).toBe("2026-05-05");
    expect(action).not.toHaveBeenCalled();
  });

  it("AC-001.4 lets a title of exactly 200 characters through", async () => {
    const action = vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => ({
      status: "created",
      task: { id: "1", title: "x".repeat(200), due_date: null },
    }));
    renderBoard({ ok: true, tasks: [] }, action);
    type("x".repeat(200));
    submit();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument();
  });

  it("AC-001.5 shows Title is required when the action reports an invalid short title, input kept", async () => {
    const action = vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => ({
      status: "invalid",
      titleError: REQUIRED,
    }));
    renderBoard({ ok: true, tasks: [] }, action);
    type("hello", "2026-05-05");
    submit();
    expect(await screen.findByText(REQUIRED)).toBeInTheDocument();
    expect(titleInput().value).toBe("hello");
    expect(dateInput().value).toBe("2026-05-05");
  });

  it("AC-001.5 pass-through: the board renders whatever title error the action returns, input kept", async () => {
    const action = vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => ({
      status: "invalid",
      titleError: TOO_LONG,
    }));
    renderBoard({ ok: true, tasks: [] }, action);
    type("hello");
    submit();
    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(titleInput().value).toBe("hello");
  });
});

describe("TaskBoard save failure", () => {
  it("AC-001.7 shows the save failure and keeps the typed title and due date", async () => {
    const action = vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => ({ status: "failed" }));
    renderBoard({ ok: true, tasks: [A] }, action);
    type("Call Bob", "2026-12-24");
    submit();
    expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument();
    expect(titleInput().value).toBe("Call Bob");
    expect(dateInput().value).toBe("2026-12-24");
    expect(within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("AC-001.7 treats a rejected action as a failed save", async () => {
    const action = vi.fn<(input: CreateTaskInput) => Promise<ActionResult>>(async () => {
      throw new Error("network");
    });
    renderBoard({ ok: true, tasks: [] }, action);
    type("Call Bob", "2026-12-24");
    submit();
    expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument();
    expect(titleInput().value).toBe("Call Bob");
    expect(dateInput().value).toBe("2026-12-24");
  });

  it("AC-001.7 can save the same input after a failed attempt (retry by the person)", async () => {
    const action = vi
      .fn<(input: CreateTaskInput) => Promise<ActionResult>>()
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "created", task: { id: "5", title: "Call Bob", due_date: null } });
    renderBoard({ ok: true, tasks: [] }, action);
    type("Call Bob");
    submit();
    await screen.findByText(SAVE_FAILED);
    submit();
    await screen.findByRole("list", { name: "Tasks" });
    expect(screen.queryByText(SAVE_FAILED)).not.toBeInTheDocument();
  });
});

describe("start page against a fake Task API", () => {
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

  it("AC-001.1 the page lists A, B, C from GET /tasks in order", async () => {
    await serve(() => ({ status: 200, json: [A, B, C] }));
    render(await Page());
    const items = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Beta"),
      expect.stringContaining("Gamma"),
    ]);
    expect(within(items[0]).getByText("2026-12-01")).toBeInTheDocument();
    expect(within(items[1]).getByText("No due date")).toBeInTheDocument();
  });

  it("AC-001.2 the page shows No tasks yet and the form for []", async () => {
    await serve(() => ({ status: 200, json: [] }));
    render(await Page());
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toHaveAttribute("type", "date");
  });

  it("AC-001.3 submitting posts to the API and appends the returned task without a second GET", async () => {
    const fake = await serve((r) =>
      r.method === "POST"
        ? { status: 201, json: { id: "9", title: "Call Bob", due_date: "2026-12-24" } }
        : { status: 200, json: [A] },
    );
    render(await Page());
    type("Call Bob", "2026-12-24");
    submit();
    await waitFor(() => expect(screen.getByText("2026-12-24")).toBeInTheDocument());
    const posts = fake.requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/tasks");
    expect(JSON.parse(posts[0].body)).toEqual({ title: "Call Bob", due_date: "2026-12-24" });
    expect(fake.requests.filter((r) => r.method === "GET")).toHaveLength(1);
    await waitFor(() => expect(titleInput().value).toBe(""));
  });

  it("AC-001.4 an invalid title sends no POST", async () => {
    const fake = await serve(() => ({ status: 200, json: [] }));
    render(await Page());
    type("   ");
    submit();
    expect(await screen.findByText(REQUIRED)).toBeInTheDocument();
    type("y".repeat(201));
    submit();
    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("AC-001.5 an API title 422 shows Title is required and keeps the input", async () => {
    await serve((r) =>
      r.method === "POST"
        ? { status: 422, json: { detail: [{ type: "x", loc: ["body", "title"], msg: "m", input: "" }] } }
        : { status: 200, json: [] },
    );
    render(await Page());
    type("Call Bob", "2026-12-24");
    submit();
    expect(await screen.findByText(REQUIRED)).toBeInTheDocument();
    expect(titleInput().value).toBe("Call Bob");
    expect(dateInput().value).toBe("2026-12-24");
  });

  it("AC-001.6 the page loads with the failure text and the form when the API is unreachable", async () => {
    process.env.TASK_API_URL = await deadUrl();
    render(await Page());
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add task" })).toBeInTheDocument();
  });

  it.each([503, 500])("AC-001.6 the page loads with the failure text on GET status %i", async (status) => {
    await serve(() => ({ status, json: { detail: "Task store unavailable" } }));
    render(await Page());
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByText("Task store unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add task" })).toBeInTheDocument();
  });

  it("AC-001.6 the page loads with the failure text on a non-array body", async () => {
    await serve(() => ({ status: 200, json: { not: "an array" } }));
    render(await Page());
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
  });

  it("AC-001.6 the page loads with the failure text when the API does not answer within 3 s", async () => {
    await serve(() => ({ hang: true }));
    render(await Page());
    expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add task" })).toBeInTheDocument();
  }, 8000);

  it("AC-001.7 a 503 on POST shows the save failure and keeps the input", async () => {
    await serve((r) =>
      r.method === "POST" ? { status: 503, json: { detail: "Task store unavailable" } } : { status: 200, json: [] },
    );
    render(await Page());
    type("Call Bob", "2026-12-24");
    submit();
    expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument();
    expect(screen.queryByText("Task store unavailable")).not.toBeInTheDocument();
    expect(titleInput().value).toBe("Call Bob");
    expect(dateInput().value).toBe("2026-12-24");
  });

  it("AC-001.7 an unreachable API on POST shows the save failure", async () => {
    await serve(() => ({ status: 200, json: [] }));
    render(await Page());
    process.env.TASK_API_URL = await deadUrl();
    type("Call Bob");
    submit();
    expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument();
    expect(titleInput().value).toBe("Call Bob");
  });

  it("AC-001.7 no answer to POST within 5 s shows the save failure and keeps the input", async () => {
    const fake = await serve((r) => (r.method === "POST" ? { hang: true } : { status: 200, json: [] }));
    render(await Page());
    type("Call Bob", "2026-12-24");
    submit();
    expect(await screen.findByText(SAVE_FAILED, undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(titleInput().value).toBe("Call Bob");
    expect(dateInput().value).toBe("2026-12-24");
    expect(fake.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  }, 12000);
});
