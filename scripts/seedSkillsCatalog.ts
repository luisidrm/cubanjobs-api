import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, closeDatabaseConnection } from "../db/client";
import { skillsCatalog } from "../db";
import { SKILLS_CATALOG } from "./seedData/skillsCatalog";
import { SKILLS_CATALOG_ES } from "./seedData/skillsCatalogEs";

/**
 * Inserts the skills catalog with its Spanish names, or updates the Spanish
 * names of entries that already exist. Safe to run any number of times, and the
 * only seeding a production database needs for skills (`npm run db:seed-skills`).
 */
export async function seedSkillsCatalog(): Promise<number> {
  await db
    .insert(skillsCatalog)
    .values(SKILLS_CATALOG.map((name) => ({ name, nameEs: SKILLS_CATALOG_ES[name] ?? null })))
    .onConflictDoUpdate({ target: skillsCatalog.name, set: { nameEs: sql`excluded.name_es` } });
  return SKILLS_CATALOG.length;
}

// Run directly: `npm run db:seed-skills`
if (process.argv[1] && /seedSkillsCatalog\.[cm]?[jt]s$/.test(process.argv[1])) {
  seedSkillsCatalog()
    .then(async (n) => {
      console.log(`✅ skills catalog: ${n} entries (English + Spanish names)`);
      await closeDatabaseConnection();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
