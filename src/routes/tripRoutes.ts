import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  createTripHandler,
  listTripsHandler,
  getTripHandler,
} from "../controllers/tripController";

const router = Router();

router.get("/", asyncHandler(listTripsHandler));      // GET /trips
router.post("/", asyncHandler(createTripHandler));    // POST /trips
router.get("/:id", asyncHandler(getTripHandler));     // GET /trips/:id

export default router;
