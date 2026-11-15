---
spec_id: 001-task-board-on-the-start-page-that-lists
title: Task board on the start page that lists and adds tasks through the Task API
status: done
priority: P1
shape: web-nextjs
parent: ika100-demo/taskboard20-gitops:001-persistent-tasks-and-web-task-board
---

# 001 — Task board on the start page that lists and adds tasks through the Task API

## Problem

The Task API keeps tasks in the memory of one instance, so every restart or redeploy loses all tasks, and a second replica would show a different list. The only way to use the board is to call the API directly; the web site is a fresh template that shows no tasks. People need tasks that survive restarts and a page where they can see the board and add tasks without a tool. A Postgres database for the API and a task board in the web UI deliver both.

## System context

Slice of the system plan `001-persistent-tasks-and-web-task-board` in `ika100-demo/taskboard20-gitops` for `taskboard20-web` (web-nextjs). The system criteria and the contract below are binding: every criterion of this spec implements one of them and names it: `(system AC-<NNN>.<n>)`.

### System criteria

- **AC-001.3** Given tasks A, B and C created in that order, when a person opens the task board page of the web site, then it lists A, B, C in creation order, each showing its title exactly as stored and its due date as `YYYY-MM-DD`, or `No due date` when it has none.
- **AC-001.4** Given no tasks exist, when a person opens the task board page, then it shows the text `No tasks yet` and the create form.
- **AC-001.5** Given the task board page is open, when a person enters the title `Call Bob`, optionally picks a due date, and submits the form, then the new task appears at the end of the list without a manual page reload, the form is emptied, and `GET /tasks` on the Task API contains a task with that title and due date (or `null`).
- **AC-001.6** Given the task board page is open, when a person submits the form with an empty or whitespace-only title, or a title longer than 200 characters, then the page shows `Title is required` or `Title must be at most 200 characters` respectively next to the title field, the typed input is kept, and no task is created.
- **AC-001.7** Given the Task API is unreachable or answers an error, when a person opens the task board page, then the page still loads and shows `Tasks could not be loaded. Try again later.` instead of the list; when a person submits a valid task in that state, the page shows `Task could not be saved. Try again.` and keeps the typed input.

### Contract

Caller: the `taskboard20-web` server, never the browser. Callee: `taskboard20-api`, at the base URL `TASK_API_URL` (dev: `http://taskboard20-api`). Every body is `application/json`. There is no authentication (spec non-goal). The API contract is the one in the API repo's `docs/specs/001-create-and-list-in-memory-tasks/design.md`, unchanged, plus the `503` below.

### `POST /tasks`

Request body:

| Field | Type | Rule |
|---|---|---|
| `title` | string | required; a JSON string, not coerced; 1 to 200 characters; at least one non-whitespace character; stored and returned as sent, not trimmed |
| `due_date` | string or null | optional, default `null`; exactly `YYYY-MM-DD` and a real calendar date; past dates are accepted |
| other fields | — | ignored (a client-sent `id` too) |

Responses:

- `201`: the created task `{"id": "<uuid4 string>", "title": "<as sent>", "due_date": "<YYYY-MM-DD>" | null}`, exactly these three fields, stored durably before the response.
- `422`: FastAPI's validation body `{"detail": [{"type", "loc", "msg", "input"}]}`. `loc[-1]` is `"title"` or `"due_date"`. Nothing is stored.
- `503`: the database is unreachable (see Errors). Nothing is stored.

The web site sends `due_date` as the date input's `YYYY-MM-DD` value, or `null` when it is empty.

### `GET /tasks`

- `200`: a JSON array of tasks, each exactly `{"id", "title", "due_date"}`, oldest first (creation order across every replica). The values equal those of the `201` that created each task.
- `503`: the database is unreachable.

### Probes (API)

- `GET /health`: `200` `{"status": "ok"}` while the process runs, whatever the database state.
- `GET /ready`: `200` `{"status": "ready"}` when a database check (`SELECT 1`) succeeds. Otherwise `503` `{"status": "not ready"}`.

### Web site (`taskboard20-web`)

- `/` is the task board.
- `TASK_API_URL` is a runtime server-side variable.
- `/api/health` and `/api/ready` do not depend on the Task API.

The fixed texts:

| Situation | Text |
|---|---|
| no tasks | `No tasks yet` |
| task without a due date | `No due date` |
| empty or whitespace-only title | `Title is required` |
| title over 200 characters | `Title must be at most 200 characters` |
| list failed | `Tasks could not be loaded. Try again later.` |
| save failed | `Task could not be saved. Try again.` |

### Errors

- **Validation:** `422` in FastAPI's standard body (above). Callers rely only on the status and `loc[-1]`, never on `type` or `msg`.
- **Database unavailable:** `503` with `{"detail": "Task store unavailable"}`. This covers connection refused, timeouts and a lost connection. The task is not created. The API does not crash or restart: each request opens or reuses a pooled connection, so the next request after recovery succeeds.
- **Unexpected API errors:** FastAPI's default `500`.
- **How the web site treats responses:**
  - `GET /tasks`: anything but `200` with a JSON array is "could not be loaded". That includes `503`, `500`, other statuses, a non-JSON body, a connection error and a timeout.
  - `POST /tasks`: anything but `201`, or a `422` whose `loc` ends in `title`, is "could not be saved". The page keeps the input.
  - A `422` naming `due_date` is also "could not be saved": the date picker cannot normally produce one.
  - The web site never shows the API's raw error text to the person.

### Timeouts

| Call | Timeout | When it expires or the other side is down |
|---|---|---|
| web → `GET /tasks` | 3 s | the page renders with `Tasks could not be loaded. Try again later.` and the form; no retry |
| web → `POST /tasks` | 5 s | `Task could not be saved. Try again.`, input kept; no automatic retry, so no duplicate task is created |
| API → Postgres, connect | 2 s | `503` |
| API → Postgres, statement | 3 s | `503` |
| API `/ready` database check | 1 s | `/ready` `503` |

A task request to the API therefore answers within about 6 s, even while the database hangs.

The kubelet's readiness probe takes a failing API replica out of the Service. With both replicas not ready, the web site's call fails fast (connection refused) and shows the failure text.

### Provided by the system

The gitops part of this plan wires these for this repo; rely on them, do not ask for them again:

- env `TASK_API_URL=http://taskboard20-api`

### Notes for this repo

The browser never calls the Task API: the page reads tasks on the server at request time (no build-time
prerendering, so the list is current on every load) and the form submits to the web site's own server
(a Server Action or a route handler), which calls the Task API. `TASK_API_URL` (no `NEXT_PUBLIC_` prefix) is read
at runtime and documented in docs/env-vars.md. `/api/ready` must not depend on the Task API. Tests stub the Task
API at the HTTP boundary (`TASK_API_URL` pointing at a fake); the dev smoke test adds a `smoke-<uuid>` task
(`@smoke @writes`) and a read-only one checks that `/` loads.

## Stories

<!-- As a <persona>, I want <goal>, so that <benefit>. -->

## Acceptance criteria

- **AC-001.1** Given the Task API's `GET /tasks` answers `200` with tasks A, B and C in that order, when a person opens the start page `/`, then it lists A, B, C in that order, each with its `title` exactly as returned and its `due_date` as `YYYY-MM-DD`, or the text `No due date` when `due_date` is `null` (system AC-001.3)
- **AC-001.2** Given the Task API's `GET /tasks` answers `200` with `[]`, when a person opens `/`, then the page shows the text `No tasks yet` and the create form with a title field and a date-picker due-date field (system AC-001.4)
- **AC-001.3** Given `/` is open, when a person enters the title `Call Bob`, optionally picks a due date, and submits, then the web site sends `POST {TASK_API_URL}/tasks` with `{"title": "Call Bob", "due_date": "<YYYY-MM-DD>"}` or `"due_date": null`, and on `201` the returned task appears at the end of the list without a page reload and the form is emptied (system AC-001.5)
- **AC-001.4** Given `/` is open, when a person submits an empty or whitespace-only title, or a title longer than 200 characters, then `Title is required` or `Title must be at most 200 characters` respectively is shown next to the title field, the typed input is kept, and no `POST /tasks` is sent (system AC-001.6)
- **AC-001.5** Given the Task API answers a `POST /tasks` with `422` whose `detail[].loc` ends in `title`, when a person submits, then the page shows `Title must be at most 200 characters` if the title is longer than 200 characters and `Title is required` otherwise, next to the title field, and keeps the typed input (system AC-001.6)
- **AC-001.6** Given the Task API is unreachable, does not answer `GET /tasks` within 3 seconds, or answers anything but `200` with a JSON array, when a person opens `/`, then the page loads with `200` and shows `Tasks could not be loaded. Try again later.` instead of the list, with the create form still shown (system AC-001.7)
- **AC-001.7** Given the Task API is unreachable, does not answer `POST /tasks` within 5 seconds, or answers anything but `201` or a `422` naming `title` (for example `503`), when a person submits a valid task, then the page shows `Task could not be saved. Try again.` and keeps the typed title and due date (system AC-001.7)

## Non-goals

## Assumptions

<!-- Spec 149: decisions taken by default, approved with the spec. One bullet each: - **A1** <the decision> (other option: <…>; affects AC-…). A revised one is struck through (~~…~~), never deleted. -->

## Open questions

<!-- Only what may not be decided by default (spec 149): security or access, money, destroying or migrating data, or a request too ambiguous to build. Approval is refused while any is open. Strike answered ones (~~…~~) and fold the answer into the criteria. -->

## Changelog

- 2026-11-16 created from the system plan, with its criteria (spec 147)
- 2026-11-16 approved
- 2026-11-16 building
- 2026-11-16 done
