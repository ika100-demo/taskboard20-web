export type Task = { id: string; title: string; due_date: string | null };
export type CreateTaskInput = { title: string; due_date: string | null };
export type ListResult = { ok: true; tasks: Task[] } | { ok: false };
export type CreateResult =
  | { kind: "created"; task: Task }
  | { kind: "invalid-title" } // 422 where some detail[].loc ends in "title"
  | { kind: "failed" }; // everything else
export type TitleError = "Title is required" | "Title must be at most 200 characters";
export type ActionResult =
  | { status: "created"; task: Task }
  | { status: "invalid"; titleError: TitleError }
  | { status: "failed" };
