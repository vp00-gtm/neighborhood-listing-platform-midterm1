import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingInputSchema,
  serviceInputSchema,
} from "../src/lib/exam-schemas.ts";

test("service input accepts valid exam fields", () => {
  const parsed = serviceInputSchema.safeParse({
    title: "House Cleaning",
    hourly_rate: 35,
    duration_minutes: 120,
    coverage_radius_miles: 15,
  });

  assert.equal(parsed.success, true);
});

test("service input rejects a short title, fractional duration, and zero coverage", () => {
  const parsed = serviceInputSchema.safeParse({
    title: "Mow",
    hourly_rate: 0,
    duration_minutes: 15.5,
    coverage_radius_miles: 0,
  });

  assert.equal(parsed.success, false);
});

test("booking input accepts the exact exam email pattern and a real calendar date", () => {
  const parsed = bookingInputSchema.safeParse({
    service_id: "b1000000-0000-4000-8000-000000000001",
    client_email: "client.a.test@example.com",
    requested_date: "2026-12-01",
    notes: "Please call before arrival.",
  });

  assert.equal(parsed.success, true);
});

test("booking input rejects invalid email and impossible date values", () => {
  const parsed = bookingInputSchema.safeParse({
    service_id: "b1000000-0000-4000-8000-000000000001",
    client_email: "client@example.c",
    requested_date: "2026-02-30",
    notes: "Please call before arrival.",
  });

  assert.equal(parsed.success, false);
});

test("booking input rejects short notes and unexpected legacy fields", () => {
  const parsed = bookingInputSchema.safeParse({
    service_id: "b1000000-0000-4000-8000-000000000001",
    client_email: "client.a.test@example.com",
    requested_date: "2026-12-01",
    notes: "Too short",
    client_id: "efaf1676-705e-412d-9280-7183714e1817",
  });

  assert.equal(parsed.success, false);
});
