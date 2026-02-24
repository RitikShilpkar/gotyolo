import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  createBookingHandler,
  getBookingHandler,
} from "../controllers/bookingController";

const router = Router();

router.post("/", asyncHandler(createBookingHandler));
router.get("/:id", asyncHandler(getBookingHandler));

export default router;
