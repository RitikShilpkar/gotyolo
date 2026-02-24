import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { paymentWebhookHandler } from "../controllers/webhookController";

const router = Router();

// POST /webhooks/payment
router.post("/payment", asyncHandler(paymentWebhookHandler));

export default router;
