import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  createBookingHandler,
  getBookingHandler,
} from "../controllers/bookingController";
import { cancelBookingHandler } from "../controllers/cancellationController";

const router = Router();

router.post("/", asyncHandler(createBookingHandler));
router.get("/:id", asyncHandler(getBookingHandler));
router.post("/:id/cancel", asyncHandler(cancelBookingHandler));

export default router;
