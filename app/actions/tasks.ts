"use server";

import { createTask } from "@/lib/tasks/api";
import type { ActionResult, CreateTaskInput } from "@/lib/tasks/types";
import { TITLE_MAX, TITLE_REQUIRED, TITLE_TOO_LONG, validateTitle } from "@/lib/tasks/validation";

export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult> {
  const err = validateTitle(input.title);
  if (err) return { status: "invalid", titleError: err };

  const due_date = input.due_date === "" ? null : input.due_date;
  const r = await createTask({ title: input.title, due_date });
  switch (r.kind) {
    case "created":
      return { status: "created", task: r.task };
    case "invalid-title":
      return {
        status: "invalid",
        titleError: [...input.title].length > TITLE_MAX ? TITLE_TOO_LONG : TITLE_REQUIRED,
      };
    default:
      return { status: "failed" };
  }
}
