# Design — 001 Task board on the start page that lists and adds tasks through the Task API

## Decisions

- **Server-only Task API client.** All calls to the Task API go through `lib/tasks/api.ts` on the Next.js server; the browser never sees `TASK_API_URL` (spec notes, system contract "Caller"). The client reads `process.env.TASK_API_URL` at call time, never at module load, so the image stays environment-neutral and tests point it at a fake HTTP server per test.
- **Page reads at request time.** `app/page.tsx` is an async Server Component with `export const dynamic = "force-dynamic"`, and the fetch uses `cache: "no-store"`: no build-time prerendering, the list is current on every load (AC-001.1, AC-001.6).
- **Create through a Server Action**, not a route handler: it needs no public endpoint, gets typed input and output, and is the App Router default. The page passes the action to the client component as a prop (`createTask`), so component tests can inject a fake and acceptance tests can call the real one against a fake Task API.
- **The client component owns the list after the first render.** The server renders the initial list; on `201` the returned task is appended to client state. No `router.refresh()`, no reload, no second `GET` (AC-001.3).
- **Validation runs twice with one module.** `lib/tasks/validation.ts` is pure and used by the client before submitting (so no request leaves the browser, AC-001.4) and by the Server Action before calling the API (so a direct action call cannot send an invalid `POST`).
- **Length counts Unicode code points** (`[...title].length`), matching the API's Python `len()`; UTF-16 `.length` would reject e.g. 150 emoji the API accepts.
- **Inputs are controlled and carry no `required` / `maxLength` attributes**, and the form has `noValidate`: the browser must neither block typing past 200 characters nor show its own bubble instead of the fixed texts, and controlled state keeps the typed input on every failure (AC-001.4, AC-001.5, AC-001.7). The form submits through `onSubmit` + `startTransition`, not `<form action>`, because React resets uncontrolled forms after an action.
- **Due dates are rendered as the string the API returned.** No `Date` parsing, so no timezone shift turns `2026-12-01` into `2026-11-30` (AC-001.1).
- **Unset `TASK_API_URL` is a failure, not a crash**: listing returns "could not be loaded", creating returns "could not be saved", and one `logger.error` line names the missing variable. `/api/ready` stays independent of the Task API (spec notes).
- No ADR: every decision here is local to this feature; the server-side-only call pattern is already set by the system plan.

## Modules

| Module | Responsibility | New / changed |
|---|---|---|
| `lib/tasks/types.ts` | `Task`, `CreateTaskInput`, `ListResult`, `CreateResult`, `TitleError`, `ActionResult` (types only, no imports) | new |
| `lib/tasks/validation.ts` | `validateTitle`, the fixed title texts (no imports) | new |
| `lib/tasks/api.ts` | `listTasks()`, `createTask()`: HTTP to the Task API with timeouts and response classification | new |
| `app/actions/tasks.ts` | `"use server"` action `createTaskAction` | new |
| `app/_components/task-board.tsx` | `"use client"` board: list, empty state, load-failure text, create form | new |
| `app/page.tsx` | async Server Component: calls `listTasks()`, renders `<TaskBoard>` | changed (template content replaced) |
| `app/globals.css` | task list and form styles, using the existing tokens | changed |
| `docs/env-vars.md` | documents `TASK_API_URL` | changed |

## Contract

### Task API (outbound, server-side) — `lib/tasks/api.ts`

Base URL: `process.env.TASK_API_URL` with any trailing `/` stripped. Both calls send and accept `application/json`.

```ts
// lib/tasks/types.ts
export type Task = { id: string; title: string; due_date: string | null };
export type CreateTaskInput = { title: string; due_date: string | null };
export type ListResult = { ok: true; tasks: Task[] } | { ok: false };
export type CreateResult =
  | { kind: "created"; task: Task }
  | { kind: "invalid-title" }   // 422 where some detail[].loc ends in "title"
  | { kind: "failed" };          // everything else
export type TitleError = "Title is required" | "Title must be at most 200 characters";
export type ActionResult =
  | { status: "created"; task: Task }
  | { status: "invalid"; titleError: TitleError }
  | { status: "failed" };

// lib/tasks/api.ts
export async function listTasks(): Promise<ListResult>;
export async function createTask(input: CreateTaskInput): Promise<CreateResult>;
```

`listTasks()`: `GET {TASK_API_URL}/tasks`, `cache: "no-store"`, `signal: AbortSignal.timeout(3000)`, no retry.
- `{ ok: true, tasks }` only when the status is `200`, the body parses as JSON, is an array, and every element has a string `id`, a string `title` and a `due_date` that is a string or `null`. Tasks are returned in the API's order, values untouched.
- `{ ok: false }` for everything else: unset `TASK_API_URL`, connection error, timeout, any other status (`503`, `500`, ...), non-JSON body, non-array, malformed element (AC-001.6). Never throws.

`createTask(input)`: `POST {TASK_API_URL}/tasks`, body exactly `{"title": <input.title>, "due_date": <input.due_date>}` (`due_date` is `null`, not omitted, when empty), header `Content-Type: application/json`, `signal: AbortSignal.timeout(5000)`, no retry (AC-001.3, AC-001.7).
- `201` with a body that is a valid `Task` → `{ kind: "created", task }` (the body's task, not the input).
- `422` whose `detail` is an array with at least one element whose `loc` is an array ending in `"title"` → `{ kind: "invalid-title" }` (AC-001.5).
- Everything else → `{ kind: "failed" }`: `422` naming only `due_date`, `503`, `500`, other statuses, `201` with a malformed body, connection error, timeout, unset `TASK_API_URL` (AC-001.7). Never throws.

Every non-success outcome logs one `logger.warn("task api call failed", { op: "list" | "create", status?: number, reason: "unconfigured" | "network" | "timeout" | "status" | "body" })`. The API's error text is never passed to the page.

### Validation — `lib/tasks/validation.ts`

```ts
export const TITLE_REQUIRED = "Title is required" as const;
export const TITLE_TOO_LONG = "Title must be at most 200 characters" as const;
export const TITLE_MAX = 200;
/** null when valid. Empty or whitespace-only (title.trim() === "") → TITLE_REQUIRED;
 *  more than 200 code points ([...title].length > 200) → TITLE_TOO_LONG. Required is checked first.
 *  The return type is structurally lib/tasks/types.ts's TitleError; no import, so t1 and t2 build in parallel. */
export function validateTitle(title: string): typeof TITLE_REQUIRED | typeof TITLE_TOO_LONG | null;
```

The title is never trimmed before sending: it is stored and returned as typed.

### Server Action — `app/actions/tasks.ts`

```ts
"use server";
export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult>;
```

1. `err = validateTitle(input.title)`; if `err` → `{ status: "invalid", titleError: err }`, no `POST` (AC-001.4).
2. `due_date = input.due_date === "" ? null : input.due_date`.
3. `r = await createTask({ title: input.title, due_date })`:
   - `created` → `{ status: "created", task: r.task }`;
   - `invalid-title` → `{ status: "invalid", titleError: [...title].length > 200 ? TITLE_TOO_LONG : TITLE_REQUIRED }` (AC-001.5);
   - `failed` → `{ status: "failed" }` (AC-001.7).

### Page and component — the DOM testers assert on

`app/page.tsx`: `export const dynamic = "force-dynamic"`; `const initial = await listTasks(); return <TaskBoard initial={initial} createTask={createTaskAction} />`. The page answers `200` in every `ListResult` case (AC-001.6).

```ts
// app/_components/task-board.tsx
"use client";
export function TaskBoard(props: {
  initial: ListResult;
  createTask: (input: CreateTaskInput) => Promise<ActionResult>;
}): JSX.Element;
```

Rendered structure (roles, names and texts are binding; class names and wrapper elements are not):

| Element | Binding detail |
|---|---|
| heading | one `<h1>` with text `Task board` |
| list | when `initial.ok` and there is at least one task: `<ul aria-label="Tasks">`, one `<li>` per task in order; each `<li>` holds the title in its own element whose text content is exactly `task.title`, and the due date in its own element whose text is exactly `task.due_date` or `No due date` (AC-001.1) |
| empty | when `initial.ok` and the list is empty: the text `No tasks yet` instead of the `<ul>` (AC-001.2); after the first successful create the `<ul>` replaces it |
| load failure | when `!initial.ok`: `<p role="alert">Tasks could not be loaded. Try again later.</p>` instead of list or empty text; the form is still rendered (AC-001.6) |
| form | `<form aria-label="Add task" noValidate>` |
| title field | `<input type="text" name="title">` labelled `Title`, no `required`, no `maxLength`; `aria-invalid="true"` and `aria-describedby="title-error"` while a title error shows |
| title error | `<p id="title-error" role="alert">` directly after the title input, text `Title is required` or `Title must be at most 200 characters` (AC-001.4, AC-001.5) |
| due-date field | `<input type="date" name="due_date">` labelled `Due date` (AC-001.2) |
| submit | `<button type="submit">` named `Add task`; `disabled` while a submission is pending |
| save failure | `<p role="alert">Task could not be saved. Try again.</p>` inside the form (AC-001.7) |

Submit behaviour (pseudocode):

```
onSubmit(e): e.preventDefault()
  clear saveError
  err = validateTitle(title); if err: titleError = err; return        // no request (AC-001.4)
  startTransition(async () => {
    r = await props.createTask({ title, due_date: dueDate === "" ? null : dueDate })
    created → tasks = [...tasks, r.task]; title = ""; dueDate = ""; titleError = null   // AC-001.3
    invalid → titleError = r.titleError                                 // input kept (AC-001.5)
    failed  → saveError = true                                          // input kept (AC-001.7)
  })
```

A rejected `createTask` promise (e.g. the action itself fails to reach the server) is treated as `failed`. Editing the title clears the title error. Titles render with `white-space: pre-wrap` so leading and repeated spaces stay visible as stored.

### Web site endpoints

Unchanged: `/api/health` and `/api/ready` do not call the Task API.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TASK_API_URL` | _(unset: the board shows its failure texts)_ | Base URL of `taskboard20-api`, read server-side at request time. Never `NEXT_PUBLIC_`. Deployed value `http://taskboard20-api`, wired by the system's gitops repo. |

## Testing seams

- Unit and acceptance tests (Vitest) set `process.env.TASK_API_URL` to a fake HTTP server (`node:http` on port 0) and assert on the requests it receives; there is no fetch mock.
- `TaskBoard` takes `createTask` as a prop, so it renders with a fake action as well as with `createTaskAction` against the fake Task API.
- `app/page.tsx` is an async function: `render(await Page())`.
- The template tests that assert on the old start page (`tests/page.test.tsx`, `e2e/home.spec.ts`) are rewritten in t5 for the new page; `e2e/smoke.spec.ts` keeps its read-only `/` check (an `<h1>` stays) and gains the `@smoke @writes` create test. Acceptance test files should use other names (e.g. `tests/task-board*.test.tsx`, `tests/task-api*.test.ts`) so they do not collide with t5's files.
