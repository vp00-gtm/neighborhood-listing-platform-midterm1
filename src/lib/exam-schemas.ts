import { z } from "zod";

export const serviceInputSchema = z.strictObject({
  title: z.string().trim().min(5),
  hourly_rate: z.number().finite().min(0).max(99_999_999.99),
  duration_minutes: z.number().int().min(15),
  coverage_radius_miles: z.number().int().positive(),
  category_ids: z
    .array(z.string().uuid())
    .default([])
    .refine((ids) => new Set(ids).size === ids.length),
});

const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function isCalendarDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export const bookingInputSchema = z.strictObject({
  service_id: z.string().uuid(),
  client_email: z.string().regex(emailPattern),
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate),
  notes: z.string().trim().min(10),
});

export const bookingEmailPattern = emailPattern;
