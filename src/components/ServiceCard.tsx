import type { Service } from "@/types";

interface ServiceCardProps {
  service: Service;
}

export default function ServiceCard({ service }: ServiceCardProps) {
  const categories = service.service_category_mappings
    .map((mapping) => mapping.category)
    .filter((category) => category !== null);

  return (
    <article className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-xl font-semibold tracking-tight">{service.name}</h3>
      <p className="mt-3 whitespace-pre-wrap break-words leading-7 text-zinc-600 dark:text-zinc-300">
        {service.description}
      </p>
      <p className="mt-5 text-lg font-semibold">
        {service.currency} {service.price_amount.toFixed(2)}
      </p>
      {categories.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            Categories
          </h4>
          <ul
            aria-label={`Categories for ${service.name}`}
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
    </article>
  );
}
