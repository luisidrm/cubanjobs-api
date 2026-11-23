import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies, jobs, users } from "../../../db";
import { AppError } from "../../lib/AppError";
import { getMySavedJobs, saveJob, unsaveJob } from "./savedJobs.queries";

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const companyIds: string[] = [];

async function makeUser(label: string) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role: "employee" })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function makeJob(title: string) {
  const [c] = await db.insert(companies).values({ name: `Saved Co ${randomUUID().slice(0, 6)}` }).returning();
  companyIds.push(c!.id);
  const [j] = await db.insert(jobs).values({ companyId: c!.id, title, description: "desc", status: "active" }).returning();
  return j!;
}

afterAll(async () => {
  // Saved jobs cascade from both the user and the job.
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("saved jobs", () => {
  it("saves a job and lists it with its company", async () => {
    const user = await makeUser("a");
    const job = await makeJob("Barista");

    await saveJob(user.id, job.id);

    const saved = await getMySavedJobs(user.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ jobId: job.id, job: { title: "Barista" } });
    expect(saved[0]!.job.company.name).toMatch(/^Saved Co/);
  });

  it("saving the same job twice is not an error and does not duplicate it", async () => {
    const user = await makeUser("b");
    const job = await makeJob("Cook");

    await saveJob(user.id, job.id);
    await expect(saveJob(user.id, job.id)).resolves.toBeUndefined();

    expect(await getMySavedJobs(user.id)).toHaveLength(1);
  });

  it("answers 404 for a job that does not exist", async () => {
    const user = await makeUser("c");
    const err = await saveJob(user.id, randomUUID()).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(404);
  });

  it("unsaves, and only for the user who asked", async () => {
    const owner = await makeUser("d");
    const other = await makeUser("e");
    const job = await makeJob("Driver");
    await saveJob(owner.id, job.id);
    await saveJob(other.id, job.id);

    await unsaveJob(owner.id, job.id);

    expect(await getMySavedJobs(owner.id)).toHaveLength(0);
    expect(await getMySavedJobs(other.id)).toHaveLength(1);
  });
});
