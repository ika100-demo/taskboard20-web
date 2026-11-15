import { expect, test } from "@playwright/test";

test.skip(!process.env.SMOKE_BASE_URL, "SMOKE_BASE_URL not set");

// Read-only, so it runs in every environment. A smoke test that creates or changes data also carries
// @writes in its title (or { tag: "@writes" }) and then runs only in dev (#474).

test("the root page loads at the base URL @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Task board" })).toBeVisible();
  const form = page.getByRole("form", { name: "Add task" });
  await expect(form.getByLabel("Title")).toBeVisible();
  await expect(form.getByRole("button", { name: "Add task" })).toBeVisible();
  // The task list or its empty state; a load-error notice is a failure.
  await expect(page.getByRole("list", { name: "Tasks" }).or(page.getByText("No tasks yet"))).toBeVisible();
});

test("a task added on the board appears at the end of the list @smoke @writes", async ({ page }) => {
  const title = `smoke-${crypto.randomUUID()}`;
  await page.goto("/");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  const last = page.getByRole("list", { name: "Tasks" }).getByRole("listitem").last();
  await expect(last).toContainText(title);
  await expect(last).toContainText("No due date");
});
