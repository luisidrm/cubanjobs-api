import "dotenv/config";
import supertokens from "supertokens-node";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import Session from "supertokens-node/recipe/session";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  users,
  companies,
  jobs,
  tags,
  jobTags,
  userSkills,
  savedJobs,
  applications,
  workExperience,
} from "../db";
import { seedSkillsCatalog } from "./seedSkillsCatalog";

const EMPLOYER_EMAIL = process.env.SEED_EMPLOYER_EMAIL ?? "employer@cubanjobs.dev";
const EMPLOYEE_EMAIL = process.env.SEED_EMPLOYEE_EMAIL ?? "employee@cubanjobs.dev";
const APPLICANT_EMAIL = "riosluisdaniel195@gmail.com";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@cubanjobs.dev";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "ChangeMe123!";

supertokens.init({
  framework: "express",
  supertokens: {
    connectionURI: process.env.SUPERTOKENS_URL ?? "http://localhost:3567",
    ...(process.env.SUPERTOKENS_API_KEY ? { apiKey: process.env.SUPERTOKENS_API_KEY } : {}),
  },
  appInfo: {
    appName: "Brújula",
    apiDomain: process.env.API_DOMAIN ?? "http://localhost:5000",
    websiteDomain: process.env.WEBSITE_DOMAIN ?? "http://localhost:5173",
    apiBasePath: "/auth",
    websiteBasePath: "/auth",
  },
  recipeList: [
    EmailPassword.init({ signUpFeature: { formFields: [{ id: "role" }] } }),
    Session.init(),
  ],
});

/** Signs up a SuperTokens account (or reuses it if it already exists) and
 * returns the SuperTokens user id, without touching our own `users` table. */
async function ensureSuperTokensUser(email: string, password: string): Promise<string> {
  const result = await EmailPassword.signUp("public", email, password);

  if (result.status === "OK") return result.user.id;

  if (result.status === "EMAIL_ALREADY_EXISTS_ERROR") {
    const existing = await supertokens.listUsersByAccountInfo("public", { email });
    const first = existing[0];
    if (!first) {
      throw new Error(`SuperTokens reports ${email} exists but listUsersByAccountInfo found nothing.`);
    }
    return first.id;
  }

  throw new Error(`Unexpected SuperTokens signup status for ${email}`);
}

async function seed() {
  console.log("🌱 Seeding database...\n");

  // ---------- users ----------
  const employerStId = await ensureSuperTokensUser(EMPLOYER_EMAIL, SEED_PASSWORD);
  const employeeStId = await ensureSuperTokensUser(EMPLOYEE_EMAIL, SEED_PASSWORD);

  const [employer] = await db
    .insert(users)
    .values({
      supertokensUserId: employerStId,
      email: EMPLOYER_EMAIL,
      role: "employer",
      isVerified: true,
      firstName: "Elena",
      lastName: "Ruiz",
      phone: "+53 5555 1234",
      bio: "Hiring manager at a growing logistics company.",
      location: "Havana, Cuba",
      onboardingCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { supertokensUserId: employerStId, onboardingCompletedAt: new Date() },
    })
    .returning();
  if (!employer) throw new Error("Failed to seed employer user");

  const [employee] = await db
    .insert(users)
    .values({
      supertokensUserId: employeeStId,
      email: EMPLOYEE_EMAIL,
      role: "employee",
      isVerified: true,
      firstName: "Carlos",
      lastName: "Fernandez",
      phone: "+53 5555 5678",
      bio: "Backend developer looking for remote opportunities.",
      location: "Santiago de Cuba, Cuba",
      cvUrl: "profiles/seed-employee/cv.pdf", // placeholder object path, no real file uploaded
      onboardingCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { supertokensUserId: employeeStId, onboardingCompletedAt: new Date() },
    })
    .returning();
  if (!employee) throw new Error("Failed to seed employee user");

  const applicantStId = await ensureSuperTokensUser(APPLICANT_EMAIL, SEED_PASSWORD);
  const [applicant] = await db
    .insert(users)
    .values({
      supertokensUserId: applicantStId,
      email: APPLICANT_EMAIL,
      role: "employee",
      isVerified: true,
      firstName: "Luis Daniel",
      lastName: "Rios",
      phone: "54588141",
      bio: "Frontend developer with a focus on React Native apps for local businesses.",
      location: "Havana, Cuba",
      linkedinUrl: "https://linkedin.com/in/luisdanielrios",
      cvUrl: "profiles/seed-applicant/cv.pdf", // placeholder object path, no real file uploaded
      onboardingCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { supertokensUserId: applicantStId, onboardingCompletedAt: new Date() },
    })
    .returning();
  if (!applicant) throw new Error("Failed to seed applicant user");

  const adminStId = await ensureSuperTokensUser(ADMIN_EMAIL, SEED_PASSWORD);
  const [admin] = await db
    .insert(users)
    .values({
      supertokensUserId: adminStId,
      email: ADMIN_EMAIL,
      role: "admin",
      isVerified: true,
      firstName: "Admin",
      lastName: "Brújula",
      onboardingCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { supertokensUserId: adminStId, onboardingCompletedAt: new Date() },
    })
    .returning();
  if (!admin) throw new Error("Failed to seed admin user");

  console.log(`✅ users: employer(${employer.id}), employee(${employee.id}), applicant(${applicant.id}), admin(${admin.id})`);

  // ---------- companies ----------
  const [company] = await db
    .insert(companies)
    .values({
      ownerId: employer.id,
      name: "Havana Logistics Co.",
      description: "Regional logistics and freight coordination.",
      website: "https://havanalogistics.example.com",
      industry: "Logistics",
      employeeCount: "11-50",
      location: "Havana, Cuba",
      isVerified: true,
      planTier: "free",
    })
    .onConflictDoNothing()
    .returning();

  // onConflictDoNothing has no unique constraint to key off here (name isn't
  // unique), so on re-run this would insert a duplicate. Guard explicitly:
  const resolvedCompany =
    company ??
    (await db.select().from(companies).where(eq(companies.ownerId, employer.id)))[0];
  if (!resolvedCompany) throw new Error("Failed to resolve seeded company");

  console.log(`✅ companies: ${resolvedCompany.id}`);

  // ---------- tags ----------
  const [remoteTag] = await db
    .insert(tags)
    .values({ name: "remote-friendly" })
    .onConflictDoNothing({ target: tags.name })
    .returning();
  const resolvedRemoteTag =
    remoteTag ?? (await db.select().from(tags).where(eq(tags.name, "remote-friendly")))[0];
  if (!resolvedRemoteTag) throw new Error("Failed to resolve seeded 'remote-friendly' tag");

  const [backendTag] = await db
    .insert(tags)
    .values({ name: "backend" })
    .onConflictDoNothing({ target: tags.name })
    .returning();
  const resolvedBackendTag =
    backendTag ?? (await db.select().from(tags).where(eq(tags.name, "backend")))[0];
  if (!resolvedBackendTag) throw new Error("Failed to resolve seeded 'backend' tag");

  console.log(`✅ tags: ${resolvedRemoteTag.id}, ${resolvedBackendTag.id}`);

  // ---------- jobs ----------
  const [job] = await db
    .insert(jobs)
    .values({
      companyId: resolvedCompany.id,
      title: "Backend Developer (Node.js)",
      description:
        "We're looking for a backend developer experienced with Node.js, PostgreSQL, and REST API design to join our logistics platform team.",
      salaryMin: 80000,
      salaryMax: 120000,
      currency: "USD",
      location: "Havana, Cuba",
      jobType: "full_time",
      isRemote: true,
      status: "active",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days out
    })
    .onConflictDoNothing()
    .returning();

  const resolvedJob =
    job ?? (await db.select().from(jobs).where(eq(jobs.companyId, resolvedCompany.id)))[0];
  if (!resolvedJob) throw new Error("Failed to resolve seeded job");

  console.log(`✅ jobs: ${resolvedJob.id}`);

  // ---------- jobTags ----------
  await db
    .insert(jobTags)
    .values([
      { jobId: resolvedJob.id, tagId: resolvedRemoteTag.id },
      { jobId: resolvedJob.id, tagId: resolvedBackendTag.id },
    ])
    .onConflictDoNothing();
  console.log(`✅ jobTags: 2 rows linked`);

  // ---------- userSkills ----------
  await db
    .insert(userSkills)
    .values({ userId: employee.id, skill: "Node.js", yearsExperience: 4 })
    .onConflictDoNothing({ target: [userSkills.userId, userSkills.skill] });
  console.log(`✅ userSkills: 1 row`);

  // ---------- savedJobs ----------
  await db
    .insert(savedJobs)
    .values({ userId: employee.id, jobId: resolvedJob.id })
    .onConflictDoNothing();
  console.log(`✅ savedJobs: 1 row`);

  // ---------- applications ----------
  await db
    .insert(applications)
    .values({
      userId: employee.id,
      jobId: resolvedJob.id,
      status: "pending",
      coverLetter: "I'd love to bring my Node.js experience to your logistics platform.",
      resumeUrl: employee.cvUrl ?? "profiles/seed-employee/cv.pdf",
    })
    .onConflictDoNothing({ target: [applications.userId, applications.jobId] });

  await db
    .insert(applications)
    .values({
      userId: applicant.id,
      jobId: resolvedJob.id,
      status: "pending",
      coverLetter: "I've shipped several React Native apps and would love to bring that to your team.",
      resumeUrl: applicant.cvUrl ?? "profiles/seed-applicant/cv.pdf",
    })
    .onConflictDoNothing({ target: [applications.userId, applications.jobId] });
  console.log(`✅ applications: 2 rows`);

  // ---------- applicant work experience ----------
  // No unique constraint on this table to key an onConflictDoNothing off of,
  // so guard idempotency explicitly (same pattern as companies/jobs/tags above).
  const existingExperience = await db
    .select()
    .from(workExperience)
    .where(eq(workExperience.userId, applicant.id));

  if (existingExperience.length === 0) {
    await db.insert(workExperience).values([
      {
        userId: applicant.id,
        title: "Frontend Developer",
        organization: "Habana Digital Studio",
        description: "Built and maintained React Native apps for local retail clients.",
        contact: "hr@habanadigital.example.com", // owner-only field — verify this never appears in toPublicUser()/employer views
        startDate: new Date("2022-01-01"),
        endDate: new Date("2023-12-31"),
      },
      {
        userId: applicant.id,
        title: "Junior Web Developer",
        organization: "Freelance",
        description: "Built small business websites using React and Tailwind CSS.",
        startDate: new Date("2020-06-01"),
        endDate: new Date("2021-12-31"),
      },
    ]);
  }
  console.log(`✅ workExperience: ${existingExperience.length === 0 ? 2 : existingExperience.length} row(s)`);

  // ---------- applicant userSkills ----------
  await db
    .insert(userSkills)
    .values([
      { userId: applicant.id, skill: "React Native", yearsExperience: 3 },
      { userId: applicant.id, skill: "TypeScript", yearsExperience: 3 },
    ])
    .onConflictDoNothing({ target: [userSkills.userId, userSkills.skill] });
  console.log(`✅ userSkills: +2 rows (applicant)`);

  // ---------- skills catalog ----------
  console.log(`✅ skillsCatalog: ${await seedSkillsCatalog()} entries`);

  console.log("\n🌱 Seed complete.");
  console.log(`   Employer login: ${EMPLOYER_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`   Employee login: ${EMPLOYEE_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`   Applicant login: ${APPLICANT_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`   Admin login: ${ADMIN_EMAIL} / ${SEED_PASSWORD}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });