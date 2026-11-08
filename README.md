# Neighborhood Listing Platform

**Course:** CIS 3610  
**Assignment:** Lab 1 — Individual Project

## Purpose and scope

This project is a neighborhood property platform starter. Lab 1 introduces local property listings, neighborhood sponsors, and voice assistance through an accessible, informational home page.

- **Implementation author:** Vanessa Palomera
- **Planned partner reviewer:** Eric Juarez (review not yet recorded)

## Technology

- Next.js App Router 16.4.3
- React and React DOM 19.3.0
- TypeScript 5.9.3
- Tailwind CSS 4.3.3
- ESLint 9.39.5
- npm for dependency management; Git and GitHub for source control
- Vercel is the intended hosting platform; deployment is pending

## Getting started

Install Node.js and npm, then run these commands from the project directory:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the local app. Stop the development server with **Ctrl+C**.

The home page source is [`src/app/page.tsx`](./src/app/page.tsx).

## Verification commands

```bash
npm run lint
npm exec tsc -- --noEmit
npm run test:validation
npm run build
```

See [Lab 1 testing notes](./docs/testing-lab1.md) for recorded command results
and pending manual checks.

## CIS 3610 Version B — Local Services & Bookings

The approved local implementation includes a forward-compatible schema
migration, role-aware RLS policies, public service browsing, provider service
submission, and booking requests. See [requirements](./docs/requirements.md)
and [security status](./docs/security-audit.md).

`npm run test:validation` runs local input-validation tests without connecting
to Supabase. `npm run test:rls` is an environment-backed integration runner;
use only dedicated disposable test accounts and a non-production project.
Neither test command applies migrations.

## Deployment

**Deployment URL:** Pending deployment.

## Lab 2 — component plan and responsibilities

Eric Juarez implements the shared types, fictional sample properties, original
illustrations and `PropertyCard` on `lab2/property-components`. Vanessa Palomera
will implement `SearchFilters`, `SponsorBanner` and final responsive integration,
then test and review Eric's PR. Eric will review Vanessa's PR. These are planned
responsibilities, not claims of completed partner reviews.

Planned hierarchy:

```text
Page
├── SearchFilters                 (Vanessa: not implemented yet)
├── Listing grid
│   └── PropertyCard × properties.length
└── SponsorBanner                 (Vanessa: not implemented yet)
```

The current page preserves the Lab 1 heading, purpose and three introductory
cards, then maps the three sample properties by stable `property.id` into a
single-column listing grid. Final grid breakpoints are left to Vanessa.
PropertyCard uses an article, an `h3` beneath the listing section's `h2`, a facts
list, a local illustration and a native disclosure button. Each card owns its
expanded state and a unique React `useId` panel ID; the page remains a Server
Component and each interactive card is a Client Component.

### Shared filter contract for Vanessa

`src/types/index.ts` preserves the supplied Google AI Studio interfaces and adds
the required `onSubmit: () => void` callback to `SearchFiltersProps`.

- `city: ""` means all cities; `maxRentUsd: undefined` means no rent limit.
- `onCityChange(city)` and `onMaxRentChange(maxRentUsd)` update controlled draft
  inputs in the future client parent. Clearing rent calls
  `onMaxRentChange(undefined)`; populated rent must be converted to a number.
- The form prevents default browser navigation and calls `onSubmit()` on submit.
  The parent then copies the draft into the applied filters and updates the
  listing grid. Typing alone must not apply the filters.
- The parent that supplies these ordinary callbacks must be a Client Component;
  do not pass function props from the current Server Component page directly.

No filter or sponsor controls are rendered yet. The existing Lab 1 Neighborhood
Sponsors introduction remains informational; it is not a SponsorBanner.

All listing names, addresses, cities and prices are fictional demonstration
data. Image provenance is in [image sources](./docs/image-sources.md). See
[Lab 2 testing and partner checklist](./docs/testing-lab2.md) for actual check
results and pending browser checks. Lint/build results alone do not establish
accessibility compliance.
