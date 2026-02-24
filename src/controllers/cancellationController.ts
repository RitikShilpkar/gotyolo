import { Request, Response } from "express";
import { z } from "zod";
import { cancelBookingService } from "../services/cancellationService";
import { findBookingById } from "../repositories/bookingRepository";
import { AppError } from "../utils/AppError";

const cancelBookingSchema = z.object({
  user_id: z.string().min(1, "user_id is required"),
});

export async function cancelBookingHandler(
  req: Request,
  res: Response
): Promise<void> {
  const bookingId = String(req.params["id"]);

  const parsed = cancelBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400);
  }

  const result = await cancelBookingService(bookingId, parsed.data.user_id);

  // Return the updated booking alongside the refund details
  const booking = await findBookingById(bookingId);

  res.status(200).json({
    booking,
    refund: {
      amount: result.refundAmount,
      issued: result.isBeforeCutoff,
      seats_released: result.seatsReleased,
    },
  });
}
