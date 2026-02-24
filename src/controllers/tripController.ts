import { Request, Response } from "express";
import { z } from "zod";
import { createTrip, findTripById, listPublishedTrips } from "../repositories/tripRepository";
import { AppError } from "../utils/AppError";

const createTripSchema = z.object({
  title: z.string().min(1),
  destination: z.string().min(1),
  start_date: z.string().datetime({ message: "start_date must be ISO 8601" }),
  end_date: z.string().datetime({ message: "end_date must be ISO 8601" }),
  price: z.number().positive(),
  max_capacity: z.number().int().min(1),
  refundable_until_days_before: z.number().int().min(0),
  cancellation_fee_percent: z.number().min(0).max(100),
});

export async function createTripHandler(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = createTripSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400);
  }

  const d = parsed.data;
  const trip = await createTrip({
    title: d.title,
    destination: d.destination,
    startDate: new Date(d.start_date),
    endDate: new Date(d.end_date),
    price: d.price,
    maxCapacity: d.max_capacity,
    refundableUntilDaysBefore: d.refundable_until_days_before,
    cancellationFeePercent: d.cancellation_fee_percent,
  });

  res.status(201).json({ trip });
}

export async function listTripsHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const trips = await listPublishedTrips();
  res.json({ trips });
}

export async function getTripHandler(
  req: Request,
  res: Response
): Promise<void> {
  const trip = await findTripById(String(req.params["id"]));
  if (!trip) throw new AppError("Trip not found", 404);
  res.json({ trip });
}
