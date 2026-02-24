import { Request, Response } from "express";
import { z } from "zod";
import { createBookingService, getBookingService } from "../services/bookingService";
import { AppError } from "../utils/AppError";

const createBookingSchema = z.object({
  trip_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "trip_id must be a valid UUID"),
  user_id: z.string().min(1, "user_id is required"),
  num_seats: z.number().int().min(1, "num_seats must be at least 1"),
  idempotency_key: z.string().min(1, "idempotency_key is required"),
});

export async function createBookingHandler(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400);
  }

  const { booking, alreadyExisted } = await createBookingService(parsed.data);

  // 201 on creation, 200 on idempotent replay
  res.status(alreadyExisted ? 200 : 201).json({ booking });
}

export async function getBookingHandler(
  req: Request,
  res: Response
): Promise<void> {
  // Express v5 types params as string | string[] — we know it's a string here
  const id = String(req.params["id"]);
  const booking = await getBookingService(id);
  res.json({ booking });
}
