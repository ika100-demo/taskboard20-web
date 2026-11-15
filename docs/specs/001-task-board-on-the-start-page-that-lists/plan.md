---
spec_id: 001-task-board-on-the-start-page-that-lists
shape: web-nextjs
spec_hash: 2a61e5cef46e
summary: Start page becomes a task board that lists tasks server-side and adds them through a Server Action calling the Task API
tasks:
  - id: t1
    title: Add title validation and the fixed title texts
    files: [lib/tasks/validation.ts]
    covers: [AC-001.4, AC-001.5]
    parallel_safe: true
    depends_on: []
  - id: t2
    title: Add the server-side Task API client with timeouts and response classification
    files: [lib/tasks/types.ts, lib/tasks/api.ts, docs/env-vars.md]
    covers: [AC-001.1, AC-001.3, AC-001.5, AC-001.6, AC-001.7]
    parallel_safe: true
    depends_on: []
  - id: t3
    title: Add the createTaskAction Server Action
    files: [app/actions/tasks.ts]
    covers: [AC-001.3, AC-001.4, AC-001.5, AC-001.7]
    parallel_safe: true
    depends_on: [t1, t2]
  - id: t4
    title: Add the TaskBoard client component (list, empty and failure states, create form)
    files: [app/_components/task-board.tsx, app/globals.css]
    covers: [AC-001.1, AC-001.2, AC-001.3, AC-001.4, AC-001.5, AC-001.6, AC-001.7]
    parallel_safe: true
    depends_on: [t1, t2]
  - id: t5
    title: Turn the start page into the task board and update the template tests and smoke tests
    files: [app/page.tsx, tests/page.test.tsx, e2e/home.spec.ts, e2e/smoke.spec.ts]
    covers: [AC-001.1, AC-001.2, AC-001.6]
    parallel_safe: true
    depends_on: [t2, t3, t4]
---

# Plan — 001 Task board on the start page

Contract, DOM structure and pseudocode: [design.md](design.md). Levels: t1, t2 → t3, t4 → t5. No gitops task: the system plan already wires `TASK_API_URL=http://taskboard20-api` for this component.

## t1 — Add title validation and the fixed title texts

**Files:** lib/tasks/validation.ts
**Covers:** AC-001.4, AC-001.5
**Goal:** one pure module that decides whether a title is valid and which fixed text applies, shared by the browser and the Server Action.

**Implementation notes:**
- Export `TITLE_REQUIRED`, `TITLE_TOO_LONG` (`as const` literals), `TITLE_MAX = 200` and `validateTitle(title): "Title is required" | "Title must be at most 200 characters" | null`, exactly as in design.md.
- Import nothing from `./types` (t2 writes it in parallel); the literal return type is structurally the `TitleError` of `types.ts`.
- Required first: `title.trim() === ""` → `TITLE_REQUIRED`; then `[...title].length > 200` → `TITLE_TOO_LONG` (code points, not UTF-16 units).
- No imports from `next` or the DOM: it runs on server and client.

**Done when:** a 200-code-point title is valid, 201 is `TITLE_TOO_LONG`, `""` and `"  \t"` are `TITLE_REQUIRED`; `devbox run quality` is clean.

## t2 — Add the server-side Task API client with timeouts and response classification

**Files:** lib/tasks/types.ts, lib/tasks/api.ts, docs/env-vars.md
**Covers:** AC-001.1, AC-001.3, AC-001.5, AC-001.6, AC-001.7
**Goal:** `listTasks()` and `createTask()` that talk to `TASK_API_URL` and turn every possible answer into the result unions of design.md, never throwing.

**Implementation notes:**
- `types.ts`: `Task`, `CreateTaskInput`, `ListResult`, `CreateResult`, `TitleError` (the two literal texts), `ActionResult`; types only, no imports.
- Read `process.env.TASK_API_URL` inside each call; strip a trailing `/`; unset → failure result plus `logger.error("TASK_API_URL is not set")`.
- `listTasks`: `GET /tasks`, `cache: "no-store"`, `AbortSignal.timeout(3000)`; validate status `200`, JSON array, each element's field types; else `{ ok: false }`.
- `createTask`: `POST /tasks`, body exactly `{ title, due_date }` with `due_date` `null` when empty, `Content-Type: application/json`, `AbortSignal.timeout(5000)`, no retry.
- `201` + valid task body → `created` with the response's task; `422` with some `detail[].loc` ending in `"title"` → `invalid-title`; everything else → `failed`.
- Wrap `fetch` and `response.json()` in try/catch; distinguish `TimeoutError` for the log `reason`.
- Log failures via `@/lib/logger` (`logger.warn("task api call failed", { op, status, reason })`); never log or return the API's error text.
- Server-only by use: no `"use client"`, imported only from `app/page.tsx` and `app/actions/tasks.ts` (`server-only` is not a dependency; do not add one).
- `docs/env-vars.md`: new `## Task API` section with the `TASK_API_URL` row from design.md.

**Done when:** against a fake `node:http` server the acceptance tests for list classification (AC-001.6) and create classification (AC-001.3 request body, AC-001.5 `invalid-title`, AC-001.7 `503`/timeout/refused) pass at the client level; `devbox run quality` is clean.

## t3 — Add the createTaskAction Server Action

**Files:** app/actions/tasks.ts
**Covers:** AC-001.3, AC-001.4, AC-001.5, AC-001.7
**Goal:** the server entry point the form calls: validates, calls `createTask`, maps the result to `ActionResult`.

**Implementation notes:**
- File starts with `"use server"`; exports only `createTaskAction(input: CreateTaskInput): Promise<ActionResult>`.
- Invalid title → `{ status: "invalid", titleError }` without calling `createTask` (no `POST`, AC-001.4).
- Normalise `due_date` `""` → `null`.
- `invalid-title` → `TITLE_TOO_LONG` when the title has more than 200 code points, else `TITLE_REQUIRED` (AC-001.5).
- `failed` → `{ status: "failed" }`.

**Done when:** with `TASK_API_URL` on a fake server, calling the action sends the exact body of AC-001.3 on valid input, sends nothing on invalid input, and maps `422 title` and `503` as above; `devbox run quality` is clean.

## t4 — Add the TaskBoard client component

**Files:** app/_components/task-board.tsx, app/globals.css
**Covers:** AC-001.1, AC-001.2, AC-001.3, AC-001.4, AC-001.5, AC-001.6, AC-001.7
**Goal:** the interactive board: renders the initial list, the empty text or the load-failure text, and the create form with its validation and save-failure handling.

**Implementation notes:**
- `"use client"`; props `{ initial: ListResult; createTask: (input) => Promise<ActionResult> }`; imports types only from `@/lib/tasks/types` and `validateTitle` from `@/lib/tasks/validation`, never `@/lib/tasks/api` or `@/app/actions/tasks`.
- Render exactly the roles, names and texts of design.md's DOM table (h1 `Task board`, `ul[aria-label=Tasks]`, `No tasks yet`, load-failure alert, form `Add task`, `Title`, `Due date` of `type="date"`, `#title-error`, save-failure alert).
- Due date displayed as the returned string or `No due date`; no `Date` parsing.
- Controlled `title` and `dueDate` state; form `noValidate`; no `required` / `maxLength`.
- Submit via `onSubmit` + `useTransition` per design.md pseudocode; button disabled while pending; a rejected promise counts as `failed`.
- On `created`: append, clear both fields and errors; on `invalid` / `failed`: keep both fields.
- Editing the title clears the title error; a new submit clears the save failure.
- `globals.css`: list and form styles from the existing tokens; task titles `white-space: pre-wrap` and `overflow-wrap: anywhere`, so the 375 px no-horizontal-scroll test still holds.

**Done when:** the component-level acceptance tests for AC-001.1 to AC-001.7 pass rendering `TaskBoard` with a fake `createTask`; `devbox run quality` is clean.

## t5 — Turn the start page into the task board and update the template tests and smoke tests

**Files:** app/page.tsx, tests/page.test.tsx, e2e/home.spec.ts, e2e/smoke.spec.ts
**Covers:** AC-001.1, AC-001.2, AC-001.6
**Goal:** `/` renders the board from a request-time `listTasks()`; the template's tests that asserted on the old page are rewritten for it, and the smoke tests the spec asks for exist.

**Implementation notes:**
- `app/page.tsx`: async default export, `export const dynamic = "force-dynamic"`, `await listTasks()`, render `<TaskBoard initial={...} createTask={createTaskAction} />`; remove the template hero, feature cards and steps (leave `feature-card.tsx` and `icons.tsx` untouched).
- `tests/page.test.tsx`: replace the template assertions with page-level tests (`render(await HomePage())`) against a fake Task API: list, empty, failure; keeps `app/**` coverage at 80 %.
- `e2e/home.spec.ts`: h1 is now `Task board`; drop the `Check health` link assertion (keep the `/api/health` request check), keep landmarks, 404 and the 375 px layout tests. Without `TASK_API_URL` the page shows the load-failure text, which these tests accept.
- `e2e/smoke.spec.ts`: keep the read-only `@smoke` test (`/` loads, h1 visible); add a `@smoke @writes` test that adds `smoke-<crypto.randomUUID()>` with no due date and sees it at the end of the list with `No due date`.

**Done when:** the page-level acceptance tests for AC-001.1, AC-001.2 and AC-001.6 pass (page answers `200` with the failure text when the fake API returns `503`, times out or is down), `devbox run ci` is green including coverage, and `devbox run e2e` passes.
