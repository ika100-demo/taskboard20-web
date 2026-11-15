"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import type { ActionResult, CreateTaskInput, ListResult, Task, TitleError } from "@/lib/tasks/types";
import { validateTitle } from "@/lib/tasks/validation";

export type TaskBoardProps = {
  initial: ListResult;
  createTask: (input: CreateTaskInput) => Promise<ActionResult>;
};

export function TaskBoard({ initial, createTask }: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initial.ok ? initial.tasks : []);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState<TitleError | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError(false);
    const err = validateTitle(title);
    if (err) {
      setTitleError(err);
      return;
    }
    startTransition(async () => {
      let r: ActionResult;
      try {
        r = await createTask({ title, due_date: dueDate === "" ? null : dueDate });
      } catch {
        r = { status: "failed" };
      }
      if (r.status === "created") {
        setTasks((prev) => [...prev, r.task]);
        setTitle("");
        setDueDate("");
        setTitleError(null);
      } else if (r.status === "invalid") {
        setTitleError(r.titleError);
      } else {
        setSaveError(true);
      }
    });
  }

  return (
    <div className="task-board">
      <h1>Task board</h1>
      {!initial.ok ? (
        <p role="alert">Tasks could not be loaded. Try again later.</p>
      ) : tasks.length === 0 ? (
        <p>No tasks yet</p>
      ) : (
        <ul aria-label="Tasks" className="task-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <span className="task-title">{task.title}</span>
              <span className="task-due">{task.due_date ?? "No due date"}</span>
            </li>
          ))}
        </ul>
      )}
      <form aria-label="Add task" noValidate onSubmit={onSubmit} className="task-form">
        <div className="field">
          <label htmlFor="task-title">Title</label>
          <input
            id="task-title"
            type="text"
            name="title"
            value={title}
            aria-invalid={titleError ? "true" : undefined}
            aria-describedby={titleError ? "title-error" : undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
          />
          {titleError ? (
            <p id="title-error" role="alert" className="field-error">
              {titleError}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="task-due-date">Due date</label>
          <input
            id="task-due-date"
            type="date"
            name="due_date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Add task
        </button>
        {saveError ? <p role="alert">Task could not be saved. Try again.</p> : null}
      </form>
    </div>
  );
}
