import { createTaskAction } from "@/app/actions/tasks";
import { listTasks } from "@/lib/tasks/api";

import { TaskBoard } from "./_components/task-board";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initial = await listTasks();
  return <TaskBoard initial={initial} createTask={createTaskAction} />;
}
