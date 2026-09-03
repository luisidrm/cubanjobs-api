import { Router } from "express";
import { getSkillsCatalog } from "./skillsCatalog.controller";

const router = Router();

router.get("/", getSkillsCatalog);

export default router;
