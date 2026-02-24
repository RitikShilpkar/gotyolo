import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  createTripHandler,
  getTripHandler,
} from "../controllers/tripController";

const router = Router();

router.post("/", asyncHandler(createTripHandler));
router.get("/:id", asyncHandler(getTripHandler));

export default router;
