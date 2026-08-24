import { db } from "../../../db/client";
import { tags, type Tag } from "../../../db";

export async function listTags(): Promise<Tag[]> {
  return db.select().from(tags);
}
