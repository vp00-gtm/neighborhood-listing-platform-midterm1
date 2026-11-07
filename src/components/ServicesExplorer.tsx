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
    typeof category.slug === "string"
  );
}

function isService(value: unknown): value is Service {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const service = value as Record<string, unknown>;
  if (
    typeof service.id !== "string" ||
    typeof service.name !== "string" ||
    typeof service.description !== "string" ||
    typeof service.price_amount !== "number" ||
    !Number.isFinite(service.price_amount) ||
    typeof service.currency !== "string" ||
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
        if (!isServicesResponse(payload)) {
          throw new Error("The services response was not in the expected format.");
        }

        setServices(payload.services);
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Services could not be loaded. Please try again.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadServices();

    return () => controller.abort();
  }, [retryCount]);

  return (
    <section aria-labelledby="services-heading" className="mt-16">
      <h2 id="services-heading" className="text-3xl font-semibold tracking-tight">
        Neighborhood services
      </h2>
      <p className="mt-3 text-zinc-600 dark:text-zinc-300">
        Browse services approved for your neighborhood.
      </p>

      {isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          Loading approved services…
        </p>
      ) : error ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-300 bg-red-50 p-5 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
            className="mt-3 min-h-11 rounded-lg border border-current px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-700 dark:focus-visible:outline-red-200"
          >
            Try again
          </button>
        </div>
      ) : services.length === 0 ? (
        <p
          role="status"
          className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          No approved services are available right now.
        </p>
      ) : (
        <ul className="mt-6 grid min-w-0 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <li key={service.id} className="min-w-0">
              <ServiceCard service={service} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
