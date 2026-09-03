import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies } from "../../../db";
import { createJob, updateJob } from "./jobs.queries";
import type { RequestingUser } from "../companies/companies.queries";

const admin: RequestingUser = { id: randomUUID(), role: "admin" };

let freeCompanyId: string;
let proCompanyId: string;
const createdCompanyIds: string[] = [];

beforeEach(async () => {
  const [freeCompany] = await db
    .insert(companies)
    .values({ name: `Free Co ${randomUUID().slice(0, 8)}`, planTier: "free" })
    .returning();
  freeCompanyId = freeCompany!.id;

  const [proCompany] = await db
    .insert(companies)
    .values({ name: `Pro Co ${randomUUID().slice(0, 8)}`, planTier: "pro" })
    .returning();
  proCompanyId = proCompany!.id;

  createdCompanyIds.push(freeCompanyId, proCompanyId);
});

afterAll(async () => {
  // Deletes cascade to each company's jobs.
  await db.delete(companies).where(inArray(companies.id, createdCompanyIds));
});

async function postActiveJob(companyId: string, title: string) {
  return createJob(admin, { companyId, title, description: "desc", status: "active" });
}

describe("active job post limit", () => {
  it("blocks a free-tier company's 3rd active job post", async () => {
    await postActiveJob(freeCompanyId, "Job 1");
    await postActiveJob(freeCompanyId, "Job 2");

    await expect(postActiveJob(freeCompanyId, "Job 3")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("does not block a pro-tier company past 2 active jobs", async () => {
    await postActiveJob(proCompanyId, "Job 1");
    await postActiveJob(proCompanyId, "Job 2");

    await expect(postActiveJob(proCompanyId, "Job 3")).resolves.toMatchObject({
      status: "active",
    });
  });

  it("does not count draft jobs toward the limit", async () => {
    await createJob(admin, { companyId: freeCompanyId, title: "Draft 1", description: "desc" });
    await createJob(admin, { companyId: freeCompanyId, title: "Draft 2", description: "desc" });
    await createJob(admin, { companyId: freeCompanyId, title: "Draft 3", description: "desc" });

    await expect(postActiveJob(freeCompanyId, "First active")).resolves.toMatchObject({
      status: "active",
    });
  });

  it("blocks transitioning a draft into active once the free-tier limit is reached", async () => {
    await postActiveJob(freeCompanyId, "Job 1");
    await postActiveJob(freeCompanyId, "Job 2");
    const draft = await createJob(admin, {
      companyId: freeCompanyId,
      title: "Draft to publish",
      description: "desc",
    });

    await expect(updateJob(admin, draft.id, { status: "active" })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
