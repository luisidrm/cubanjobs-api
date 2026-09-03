import { db } from "../../../db/client";
import { skillsCatalog, type SkillCatalogEntry } from "../../../db";

export async function listSkillsCatalog(): Promise<SkillCatalogEntry[]> {
  return db.select().from(skillsCatalog).orderBy(skillsCatalog.name);
}
