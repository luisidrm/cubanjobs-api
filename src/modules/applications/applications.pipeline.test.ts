import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/client";
import { applications, companies, jobs, notifications, users } from "../../../db";
import { stageEmail } from "../../lib/applicationMessages";
import { escapeHtml } from "../../lib/emailTemplate";
import { enqueueApplicationStatusNotification } from "../../lib/queue";
import type { RequestingUser } from "../companies/companies.queries";
import { updateApplicationStatus, withdrawApplication } from "./applications.queries";
import { updateApplicationStatusSchema } from "./applications.schemas";

// The email/push job goes through Redis, which these tests don't run.
vi.mock("../../lib/queue", () => ({ enqueueApplicationStatusNotification: vi.fn() }));

const admin: RequestingUser = { id: randomUUID(), role: "admin" };
const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const companyIds: string[] = [];

async function makeApplication(label: string) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role: "employee" })
    .returning();
  userIds.push(u!.id);
  const [c] = await db.insert(companies).values({ name: "Pipeline Co" }).returning();
  companyIds.push(c!.id);
  const [j] = await db.insert(jobs).values({ companyId: c!.id, title: "Barista", description: "d", status: "active" }).returning();
  const [a] = await db.insert(applications).values({ userId: u!.id, jobId: j!.id, resumeUrl: "cv.pdf" }).returning();
  return { user: u!, application: a! };
}

const inbox = (userId: string) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, "application_status_changed")));

beforeEach(() => vi.mocked(enqueueApplicationStatusNotification).mockClear());

afterAll(async () => {
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("application pipeline", () => {
  it("moves an application to the interview stage and tells the applicant in Spanish", async () => {
    const { user, application } = await makeApplication("a");

    const updated = await updateApplicationStatus(admin, application.id, { status: "interview" });

    expect(updated.status).toBe("interview");
    const [note] = await inbox(user.id);
    expect(note).toMatchObject({ title: "¡Pasas a entrevista!" });
    expect(note!.body).toContain("Pipeline Co quiere entrevistarte para Barista");
    expect(enqueueApplicationStatusNotification).toHaveBeenCalledWith(expect.objectContaining({ status: "interview" }));
  });

  it("does not notify again when the stage does not change", async () => {
    const { user, application } = await makeApplication("b");
    await updateApplicationStatus(admin, application.id, { status: "reviewed" });
    await updateApplicationStatus(admin, application.id, { status: "reviewed" });

    expect(await inbox(user.id)).toHaveLength(1);
    expect(enqueueApplicationStatusNotification).toHaveBeenCalledTimes(1);
  });

  it("refuses to move an application the applicant withdrew", async () => {
    const { user, application } = await makeApplication("c");
    await withdrawApplication({ id: user.id, role: "employee" }, application.id);

    await expect(updateApplicationStatus(admin, application.id, { status: "interview" })).rejects.toMatchObject({ statusCode: 409 });
    expect(await inbox(user.id)).toHaveLength(0);
  });

  it("lets employers choose interview but not withdrawn", () => {
    expect(updateApplicationStatusSchema.safeParse({ status: "interview" }).success).toBe(true);
    expect(updateApplicationStatusSchema.safeParse({ status: "withdrawn" }).success).toBe(false);
  });

  it("never lets user text become markup in the email", () => {
    const { html } = stageEmail("accepted", "<b>Ana</b>", '<a href="x">job</a>', "A & B");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<a ");
    expect(html).toContain("A &amp; B");
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});
