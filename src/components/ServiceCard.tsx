"use client";

import { useId } from "react";
import type { Service, ServiceCategory } from "@/types";
import BookingForm from "@/components/BookingForm";

interface ServiceCardProps {
  service: Service;
}

export default function ServiceCard({ service }: ServiceCardProps) {
  const titleId = useId();
  const categories = service.service_category_mappings
    .map((mapping) => mapping.category)
    .filter((category): category is ServiceCategory => category !== null && category.active_status);

  return (
    <article aria-labelledby={titleId} className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm [overflow-wrap:anywhere] dark:border-zinc-800 dark:bg-zinc-900">
      <header>
        <h3 id={titleId} className="text-xl font-semibold tracking-tight">{service.title}</h3>
        <p className="mt-3 whitespace-pre-wrap leading-7 text-zinc-600 dark:text-zinc-300">
          {service.description?.trim() ? service.description : "No description provided."}
        </p>
      </header>
      <ul aria-label={`Service specifications for ${service.title}`} className="mt-5 list-disc space-y-3 pl-5">
        <li><span className="font-semibold">Hourly rate:</span> ${service.hourly_rate.toFixed(2)} per hour (USD)</li>
        <li><span className="font-semibold">Duration:</span> {service.duration_minutes} minutes</li>
        <li><span className="font-semibold">Coverage radius:</span> {service.coverage_radius_miles} {service.coverage_radius_miles === 1 ? "mile" : "miles"}</li>
      </ul>
      {categories.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            Categories
          </h4>
          <ul
            aria-label={`Categories for ${service.title}`}
            className="mt-2 flex flex-wrap gap-2"
          >
            {categories.map((category) => (
              <li
                key={category.id}
                className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
              >
                {category.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      <BookingForm serviceId={service.id} serviceTitle={service.title} />
    </article>
  );
}
