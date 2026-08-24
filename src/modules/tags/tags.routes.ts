import { Router } from "express";
import { getTags } from "./tags.controller";

const router = Router();

router.get("/", getTags);

export default router;
