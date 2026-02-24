import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getTripMetricsHandler,
  getAtRiskTripsHandler,
} from "../controllers/adminController";

const router = Router();

// Order matters: /trips/at-risk must be declared before /trips/:id
// otherwise Express matches "at-risk" as the :id param
router.get("/trips/at-risk", asyncHandler(getAtRiskTripsHandler));
router.get("/trips/:id/metrics", asyncHandler(getTripMetricsHandler));

export default router;
