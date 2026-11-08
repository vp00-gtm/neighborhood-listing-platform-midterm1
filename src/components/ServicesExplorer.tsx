"use client";

import { useEffect, useState } from "react";
import ServiceCard from "@/components/ServiceCard";
import type { Service, ServiceCategory } from "@/types";

interface ServicesResponse {
  services: Service[];
}

function isCategory(value: unknown): value is ServiceCategory {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const category = value as Record<string, unknown>;
  return (
    typeof category.id === "string" &&
    typeof category.name === "string" &&
    typeof category.slug === "string" &&
    typeof category.active_status === "boolean"
  );
}

function isService(value: unknown): value is Service {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const service = value as Record<string, unknown>;
  if (
    typeof service.id !== "string" ||
    typeof service.title !== "string" ||
    (service.description !== null && typeof service.description !== "string") ||
    typeof service.hourly_rate !== "number" ||
    !Number.isFinite(service.hourly_rate) ||
    service.hourly_rate < 0 ||
    typeof service.duration_minutes !== "number" ||
    !Number.isInteger(service.duration_minutes) ||
    service.duration_minutes < 15 ||
    typeof service.coverage_radius_miles !== "number" ||
    !Number.isInteger(service.coverage_radius_miles) ||
    service.coverage_radius_miles <= 0 ||
    typeof service.created_at !== "string" ||
    !Array.isArray(service.service_category_mappings)
  ) {
    return false;
  }

  return service.service_category_mappings.every((mapping: unknown) => {
    if (typeof mapping !== "object" || mapping === null) {
      return false;
    }

    const categoryMapping = mapping as Record<string, unknown>;
    return (
      categoryMapping.category === null ||
      isCategory(categoryMapping.category)
    );
  });
}

function isServicesResponse(value: unknown): value is ServicesResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    Array.isArray(response.services) && response.services.every(isService)
  );
}

export default function ServicesExplorer() {
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // Bound both the initial fetch and reading its body. Aborting alone is not
    // enough: update the UI even if an underlying operation never settles.
    const timeout = setTimeout(() => {
      controller.abort();
      if (active) {
        setError("Services are taking too long to load. Please try again.");
        setIsLoading(false);
      }
    }, 15_000);

    async function loadServices() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/services", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Services could not be loaded. Please try again.");
        }

        const payload: unknown = await response.json();
        if (!active || controller.signal.aborted) {
          return;
        }
        if (!isServicesResponse(payload)) {
          throw new Error("The services response was not in the expected format.");
        }

        setServices(payload.services);
      } catch (loadError) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setError(
          loadError instanceof Error && !(loadError instanceof TypeError || loadError instanceof SyntaxError)
            ? loadError.message
            : "Services could not be loaded. Please try again.",
        );
      } finally {
        clearTimeout(timeout);
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadServices();

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [retryCount]);

  return (
    <section aria-labelledby="services-heading" className="mt-16">
      <h2 id="services-heading" className="text-3xl font-semibold tracking-tight">
        Neighborhood services
      </h2>
      <p className="mt-3 text-zinc-600 dark:text-zinc-300">
        Browse services approved for your neighborhood.
      </p>

      <button
        type="button"
        aria-controls="services-results"
        aria-disabled={isLoading}
        onClick={() => {
          if (isLoading) return;
          setIsLoading(true);
          setError(null);
          setRetryCount((count) => count + 1);
        }}
        className="mt-5 min-h-11 rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-800 aria-disabled:cursor-wait aria-disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 dark:border-emerald-400 dark:text-emerald-300 dark:focus-visible:ring-emerald-300 dark:focus-visible:ring-offset-zinc-950"
      >
        {isLoading ? "Loading services…" : error ? "Try again" : "Refresh services"}
      </button>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-4 text-zinc-600 dark:text-zinc-300"
      >
        {isLoading ? "Loading approved services…" : error ? "" : services.length === 0
          ? "No approved services are available right now."
          : `${services.length} approved ${services.length === 1 ? "service" : "services"} available.`}
      </p>
      <div id="services-results" aria-busy={isLoading}>
        {!isLoading && error ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-300 bg-red-50 p-5 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
          >
            <p>{error}</p>
          </div>
        ) : !isLoading && services.length > 0 && !error ? (
          <ul aria-label="Approved neighborhood services" className="mt-6 grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <li key={service.id} className="min-w-0">
                <ServiceCard service={service} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
