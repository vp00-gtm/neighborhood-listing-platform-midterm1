"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ServiceCategory } from "@/types";

function isServiceCategory(value: unknown): value is ServiceCategory {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const category = value as Record<string, unknown>;
  return (
    typeof category.id === "string" &&
    typeof category.name === "string" &&
    typeof category.slug === "string" &&
    typeof category.active_status === "boolean" &&
    category.active_status
  );
}

export default function ProviderServiceForm() {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCategories() {
      try {
        const response = await fetch("/api/service-categories", {
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(readError(payload, "Active categories could not be loaded."));
        }
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("categories" in payload) ||
          !Array.isArray(payload.categories)
        ) {
          throw new Error("The category response was not in the expected format.");
        }
        const valid = payload.categories.every(isServiceCategory);
        if (!valid) {
          throw new Error("The category response was not in the expected format.");
        }
        setCategories(payload.categories);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setCategoryError(
            loadError instanceof Error
              ? loadError.message
              : "Active categories could not be loaded.",
          );
        }
      }
    }

    void loadCategories();
    return () => controller.abort();
  }, []);

  async function submitService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const body = {
      title: String(formData.get("title") ?? ""),
      hourly_rate: Number(formData.get("hourly_rate")),
      duration_minutes: Number(formData.get("duration_minutes")),
      coverage_radius_miles: Number(formData.get("coverage_radius_miles")),
      category_ids: formData.getAll("category_ids").map(String),
    };

    try {
      const createResponse = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const created: unknown = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(readError(created, "Unable to save the service draft."));
      }

      const serviceId = readServiceId(created);
      if (!serviceId) {
        throw new Error("The draft was created, but its identifier was not returned.");
      }

      const submitResponse = await fetch(
        `/api/services/${encodeURIComponent(serviceId)}/submit`,
        { method: "POST" },
      );
      const submitted: unknown = await submitResponse.json();
      if (!submitResponse.ok) {
        throw new Error(
          `Draft saved, but submission failed: ${readError(submitted, "try again later.")}`,
        );
      }

      form.reset();
      setMessage("Your service was submitted for administrator review.");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit the service.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submitService}>
      <label className="grid gap-1 font-medium">
        Service title
        <input
          required
          minLength={5}
          name="title"
          className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <fieldset className="grid gap-2">
        <legend className="font-medium">Active categories (optional)</legend>
        {categoryError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {categoryError}
          </p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            No active categories are available.
          </p>
        ) : (
          categories.map((category) => (
            <label key={category.id} className="flex items-center gap-2">
              <input type="checkbox" name="category_ids" value={category.id} />
              {category.name}
            </label>
          ))
        )}
      </fieldset>
      <label className="grid gap-1 font-medium">
        Hourly rate
        <input
          required
          type="number"
          min={0}
          max={99_999_999.99}
          step="0.01"
          name="hourly_rate"
          className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <label className="grid gap-1 font-medium">
        Duration (minutes)
        <input
          required
          type="number"
          min={15}
          step={1}
          name="duration_minutes"
          className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <label className="grid gap-1 font-medium">
        Coverage radius (miles)
        <input
          required
          type="number"
          min={1}
          step={1}
          name="coverage_radius_miles"
          className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <button
        type="submit"
        disabled={isSubmitting}
        className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {isSubmitting ? "Submitting…" : "Save draft and submit for review"}
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    </form>
  );
}

function readError(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function readServiceId(payload: unknown) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("service" in payload) ||
    typeof payload.service !== "object" ||
    payload.service === null ||
    !("id" in payload.service) ||
    typeof payload.service.id !== "string"
  ) {
    return null;
  }
  return payload.service.id;
}
