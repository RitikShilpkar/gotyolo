import { Request, Response } from "express";
import { z } from "zod";
import { processWebhookService } from "../services/webhookService";
import { AppError } from "../utils/AppError";

const webhookSchema = z.object({
  booking_id: z.string().uuid("booking_id must be a valid UUID"),
  status: z.enum(["success", "failed"]),
  idempotency_key: z.string().min(1, "idempotency_key is required"),
});

export async function paymentWebhookHandler(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400);
  }

  const result = await processWebhookService(parsed.data);

  // Always 200 — payment providers must not retry based on our response.
  // The idempotency_key guarantees we process each event exactly once.
  res.status(200).json({
    received: true,
    action: result.action,
  });
}
