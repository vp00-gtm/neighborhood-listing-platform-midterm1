"use client";

import { useState, type FormEvent } from "react";

interface BookingFormProps {
  serviceId: string;
  serviceTitle: string;
}

export default function BookingForm({
  serviceId,
  serviceTitle,
}: BookingFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const body = {
      service_id: serviceId,
      client_email: String(formData.get("client_email") ?? ""),
      requested_date: String(formData.get("requested_date") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    };

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const detail =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Your booking request could not be submitted.";
        throw new Error(detail);
      }

      form.reset();
      setMessage("Your request was received. The provider will follow up.");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Your booking request could not be submitted.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <details className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <summary className="min-h-11 cursor-pointer rounded-lg py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 dark:focus-visible:outline-emerald-300">Request {serviceTitle}</summary>
      <form aria-label={`Booking request for ${serviceTitle}`} className="mt-4 grid min-w-0 gap-3" onSubmit={submitBooking}>
        <label className="grid gap-1 text-sm font-medium">
          Email
          <input
            required
            type="email"
            name="client_email"
            autoComplete="email"
            className="min-h-11 min-w-0 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Requested date
          <input
            required
            type="date"
            name="requested_date"
            className="min-h-11 min-w-0 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Notes for {serviceTitle} (at least 10 characters)
          <textarea
            required
            minLength={10}
            name="notes"
            rows={3}
            className="min-w-0 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          aria-label={`Send booking request for ${serviceTitle}`}
          className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 dark:focus-visible:outline-emerald-300"
        >
          {isSubmitting ? "Sending request…" : "Send booking request"}
        </button>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      </form>
    </details>
  );
}
