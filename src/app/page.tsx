import PropertyExplorer from "@/components/PropertyExplorer";
import ServicesExplorer from "@/components/ServicesExplorer";
import { properties } from "@/data/properties";
import SponsorBanner from "@/components/SponsorBanner";
import type { Sponsor } from "@/types";

const features = [
  {
    title: "Listings",
    description:
      "Explore homes and local properties to find a place that feels right for you.",
  },
  {
    title: "Neighborhood Sponsors",
    description:
      "Discover the local businesses and organizations that help neighborhoods thrive.",
  },
  {
    title: "Voice Help",
    description:
      "Learn how voice assistance can make it easier to find information around the platform.",
  },
];

const sponsor: Sponsor = {
  id: "example-neighborhood-services",
  businessName: "Example Neighborhood Services (Fictional Demo)",
  websiteUrl: "https://example.com",
};

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-10 sm:py-24">
      <div className="mx-auto w-full max-w-5xl">
        <header className="max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
            Neighborhood Listing Platform
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Find your place in the neighborhood.
          </h1>
          <p className="mt-6 text-lg leading-8 text-zinc-600 dark:text-zinc-300">
            Explore local property listings, meet neighborhood sponsors, and
            learn about voice help—all in one welcoming place.
          </p>
        </header>

        <section
          aria-label="Explore the platform"
          className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 className="text-xl font-semibold">{feature.title}</h2>
              <p className="mt-3 leading-7 text-zinc-600 dark:text-zinc-300">
                {feature.description}
              </p>
            </article>
          ))}
        </section>

        <div className="mt-12 max-w-2xl">
          <SponsorBanner sponsor={sponsor} />
        </div>

        <ServicesExplorer />

        <section aria-labelledby="listings-heading" className="mt-16">
          <h2 id="listings-heading" className="text-3xl font-semibold tracking-tight">
            Sample property listings
          </h2>
          <p className="mt-3 text-zinc-600 dark:text-zinc-300">
            Fictional demonstration data: these addresses, cities, prices, and
            original illustrations do not advertise real rentals.
          </p>
          <PropertyExplorer properties={properties} />
        </section>
      </div>
    </main>
  );
}
