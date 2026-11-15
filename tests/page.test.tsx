import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import HomePage from "@/app/page";

import { startFakeApi, type FakeApi, type FakeReply } from "./fake-task-api";

describe("HomePage", () => {
  let api: FakeApi | undefined;
  const saved = process.env.TASK_API_URL;

  async function serve(reply: FakeReply) {
    api = await startFakeApi(() => reply);
    process.env.TASK_API_URL = api.url;
  }

  beforeEach(() => {
    api = undefined;
  });

  afterEach(async () => {
    await api?.close();
    if (saved === undefined) delete process.env.TASK_API_URL;
    else process.env.TASK_API_URL = saved;
  });

  it("lists the tasks the API returns, in order", async () => {
    await serve({
      status: 200,
      json: [
        { id: "1", title: "Alpha", due_date: "2026-12-01" },
        { id: "2", title: "Beta", due_date: null },
      ],
    });
    render(await HomePage());
    expect(screen.getByRole("heading", { level: 1, name: "Task board" })).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Alpha2026-12-01", "BetaNo due date"]);
    expect(api?.requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /tasks"]);
  });

  it("shows the empty text and the create form when there are no tasks", async () => {
    await serve({ status: 200, json: [] });
    render(await HomePage());
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add task" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toHaveAttribute("type", "date");
  });

  it("shows the load-failure text and still the form when the API answers 503", async () => {
    await serve({ status: 503, json: { detail: "Task store unavailable" } });
    render(await HomePage());
    expect(screen.getByRole("alert")).toHaveTextContent("Tasks could not be loaded. Try again later.");
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add task" })).toBeInTheDocument();
  });

  it("shows the load-failure text when TASK_API_URL is not set", async () => {
    delete process.env.TASK_API_URL;
    render(await HomePage());
    expect(screen.getByRole("alert")).toHaveTextContent("Tasks could not be loaded. Try again later.");
  });

  it("keeps a single level-1 heading", async () => {
    await serve({ status: 200, json: [] });
    render(await HomePage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
