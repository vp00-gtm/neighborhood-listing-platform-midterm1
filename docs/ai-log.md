# CIS 3610 Lab 1 AI Log

**Author / implementation author:** Vanessa Palomera  
**Planned partner reviewer:** Eric Juarez (review not yet recorded)

## Lab 1

The reviewed comparison supplied for this record describes differences in AI explanations of the neighborhood-platform development stack. Its key takeaways are:

- One response emphasized a starter plan, proposed file structure, setup commands, and accessibility recommendations.
- Another emphasized plain-language descriptions of the technologies and the local-development-to-hosting workflow.
- The supplied comparison presents these as differences in emphasis and coverage, not direct contradictions.
- The learning note recommends checking technical details against the actual project and official documentation rather than treating AI suggestions as verified facts.

The comparison also identifies claims to verify: App Router routing, Tailwind configuration for the installed version, GitHub-to-Vercel deployment behavior, server/client component conventions, accessibility requirements, and deployment timing. Its caution is that an AI summary or accessibility recommendation does not itself prove technical correctness, a successful deployment, or WCAG conformance.

### Source and provenance note

The task instruction identifies **ChatGPT and Gemini as the original sources** and **Claude as comparison assistance**. The supplied reviewed comparison itself labels its original responses “AI Studio” and “Gemini.” The original prompts and full response texts were not included, and the AI Studio/ChatGPT attribution difference cannot be resolved from the available material. No text is relabeled as a ChatGPT response; missing source details are marked **Awaiting student input**.

### AI activity record

| Tool | Prompt | Output used | Output rejected | Verification | Commit |
|---|---|---|---|---|---|
| ChatGPT (original source per task instruction) | The reviewed comparison supplies this prompt: “I am a beginner building a neighborhood listing platform for CIS 3610. Explain Next.js App Router, TypeScript, Tailwind CSS, GitHub and Vercel in plain language. Explain what each does, how they connect, and what runs locally versus on the host. Identify common beginner mistakes. Do not invent installation results or credentials.” The separate ChatGPT prompt is **Awaiting student input**. | A direct ChatGPT response was not supplied; no response content is attributed to ChatGPT. | No rejected ChatGPT output is recorded; source response is **Awaiting student input**. | Cannot verify the original response without the source text. | Pending documentation commit |
| Gemini (original source per task instruction) | The prompt above is included in the supplied comparison; whether it is the exact prompt used for Gemini is **Awaiting student input**. | The supplied comparison summarizes Gemini as explaining technology roles, local versus hosted workflow, and common beginner mistakes. Its excerpts and summary are recorded as supplied comparison notes, not as an independently retrieved response. | No rejected Gemini output is recorded; full source response is **Awaiting student input**. | Technical claims remain to be checked against the official documentation listed below. | Pending documentation commit |
| Claude (comparison assistance) | Exact prompt is **Awaiting student input**. | Comparison assistance is identified in the task instruction; its specific output is **Awaiting student input**. | No rejected output is recorded. | No separate Claude response was supplied for verification. | Pending documentation commit |
| Copilot SDK in VS Code (this documentation session) | “please reverse the rolls of Eric and Vanessa” with the supplied Lab 1 documentation and evidence requirements. | Documented the existing app-shell baseline at `6fdc198`; created setup, testing, evidence, AI-log, and README documentation with Vanessa as implementation author and Eric as planned reviewer; recorded actual environment versions and observed CLI checks; retained missing browser and source evidence as pending. | No application code or unobserved browser results were added. | CLI results are captured in the linked text logs. Browser checks remain pending; source attribution discrepancy is disclosed above. | Pending documentation commit; app baseline `6fdc198` |

### Claims and references to check

The reviewed comparison recommends validating these points before treating them as established:

1. App Router route conventions against the actual project and Next.js documentation.
2. Tailwind configuration advice against the installed Tailwind version.
3. GitHub-to-Vercel automatic deployments against the repository and deployment configuration; a push does not guarantee an immediate successful deployment.
4. Server/client component behavior against the installed Next.js documentation.
5. Accessibility recommendations against applicable criteria; recommendations alone do not demonstrate WCAG 2.1 AA conformance.

References supplied with the comparison:

- [Next.js App Router](https://nextjs.org/docs/app)
- [TypeScript documentation](https://www.typescriptlang.org/docs/)
- [Tailwind CSS documentation](https://tailwindcss.com/docs)
- [GitHub documentation](https://docs.github.com/en)
- [Vercel Git deployments](https://vercel.com/docs/deployments/git)
- [Web Content Accessibility Guidelines 2.1](https://www.w3.org/TR/WCAG21/)

## Eric Juarez — Lab 2

Date: 2026-10-24. Branch: `lab2/property-components`. Implementation starts from
the completed Lab 1 merge `2b1f1fa`. All Lab 1 entries above are preserved.
Vanessa's testing/review and Eric's later review of her work remain pending.

| Tool | Prompt | Output used | Output rejected | Verification | Commit |
|---|---|---|---|---|---|
| Google AI Studio (proposal supplied by the student) | Original AI Studio prompt was not supplied. The student pasted interfaces for Property, Sponsor, PropertyCardProps, SponsorBannerProps and SearchFiltersProps, with an explanation of required and optional fields. | Accepted the supplied fields, numeric rent, required descriptive imageAlt, and optional maxRentUsd. Added the assignment-required onSubmit callback and documented draft-versus-applied filter state, empty-city and undefined-rent conventions. | No supplied interface was rejected. The proposal lacked onSubmit, so it was extended. Actual SearchFilters and SponsorBanner implementations are deferred to Vanessa. | Compared proposal with the supplied Lab 2 requirements; the implementation uses typed sample data and shared PropertyCardProps. Command results are recorded in testing-lab2.md. Required string types do not by themselves guarantee meaningful alt text, valid URLs or accessibility. | `8854758` (shared interfaces) |
| Codex (this implementation session) | Student request begins “Help me implement Eric Juarez’s portion of CIS 3610 Lab 2: Semantic Components, Responsive Design, and Accessibility.” Summary: inspect the partner repository, preserve Lab 1, implement only shared types/data/PropertyCard and minimal integration, document evidence, run checks, and do not commit, push or open a PR. The original attached request also supplied the AI Studio proposal above. | Created the shared types and callback contract, three typed fictional properties including a studio, three original SVG illustrations and source notes, a stateful semantic card with a native disclosure button, and minimal page integration. Read installed Next.js client-boundary and image guides before implementation. | No generated output was rejected. Final responsive integration, SearchFilters, SponsorBanner, backend, authentication and voice implementation were excluded as instructed. Browser checks were not represented as completed. | Codex command results and exact pending manual steps are in testing-lab2.md. No controllable browser was available; no partner testing or approval is claimed. | `8854758` (types), `eb73cc2` (data/artwork), `d50a584` (card/integration/docs) |
| Codex (commit/push session, 2026-10-24) | “Help me commit and push Eric Juarez’s completed first-half implementation for CIS 3610 Lab 2 in this workspace.” Student authorized logical commits and a non-force push, required actual implementation references, and prohibited opening a PR, review, merge or deployment. | Inspected branch, remote, attribution, all changed files and prior notes; reran lint, TypeScript and build; created explicit-path commits for shared interfaces, data/artwork, and PropertyCard integration/documentation. Prepared the branch for the authorized normal push; remote confirmation is reported separately after pushing. | No output rejected. No invented browser retest, partner approval or self-referencing documentation hash. | All three required CLI checks passed with exit 0. The student reported a data-zotero-connector-injected hydration warning; no documented Zotero-disabled retest was initially found. Codex asked, and the student confirmed the retest passed (“yes its good to go”). Recorded as resolved per student report, not as a Codex-observed browser test. Other manual checks and partner review remain pending. See testing-lab2.md. | `8854758`, `eb73cc2`, `d50a584`; follow-up documentation records these existing references |

### Vanessa Palomera — Lab 2 Planning and Development Support

**Purpose:** I used ChatGPT to help me understand the Lab 2 requirements, plan
the implementation, and prepare for testing and GitHub collaboration.

**How I used ChatGPT:**

- It helped me create prompts for Copilot to implement and connect the
  `SponsorBanner`, `SearchFilters`, and `PropertyExplorer` components.
- It explained Git status, modified and untracked files, and the steps needed
  to prepare commits.
- It helped me understand the testing process and prepare a pull request
  description for my partner to review.
- It helped me plan accessibility testing, responsive layout testing, and the
  Lighthouse accessibility audit.

**Outcome:** ChatGPT helped me break the assignment into smaller steps and
understand the development and collaboration process. Copilot assisted with
implementing the components, running checks, organizing commits, and pushing
the feature branch to GitHub.

**Human review and testing:** I verified the implementation and personally
performed the required manual tests with my partner. We reviewed the application
rather than relying only on AI-generated code or AI-reported test results.

**Reflection:** Using ChatGPT helped me understand the assignment and work
through the process step by step. Copilot helped with implementation, while my
partner and I reviewed and tested the results. This experience taught me that
AI-generated code still needs to be checked and tested by the people developing
the application.

## Eric Juarez — PR #3 review evidence, 2026-10-24

Earlier entries above are historical records and remain preserved. This is
Eric's reviewer evidence, not Vanessa's AI-use record or a submitted approval.

| Tool | Prompt | Output used | Output rejected | Verification | Commit |
|---|---|---|---|---|---|
| Codex (review evidence documentation) | Eric asked to add the supplied Lighthouse tests to the repository, confirmed sponsor/layout/filter tests passed, and confirmed the application worked in a browser without Zotero. | Preserved both supplied Lighthouse JSON reports unchanged, recorded scores and findings in testing-lab2.md, attributed browser tests to Eric, and marked Zotero resolved rather than an outstanding retest. | No output rejected. Did not convert Lighthouse scores into full accessibility compliance, infer detailed unreported keyboard/viewport results, or invent Vanessa's AI critiques. | Parsed both reports and verified copied bytes; Accessibility 100 in both, 25 automated accessibility passes each, no automated accessibility failures. Review checkout: fbce716. Specific unconfirmed manual details remain identified separately. | Pending documentation commit; implementation reviewed at `fbce716` |

## CIS 3610 Midterm Version B — Parts 1 and 2, 2026-11-06

**Task:** Repository preparation and requirements documentation.

**AI tool:** Copilot SDK in VS Code.

**Prompt summary:** Update `.gitignore` to exclude dependencies, environment
files, build output, and Next.js output; check tracked content for common
credential patterns; review but do not modify this AI log; and create
`docs/requirements.md` with three sized user stories, Given/When/Then criteria,
and database/API traceability. Do not commit or push.

**AI assistance / output:** Reviewed the existing project structure and drafted
requirements for browsing approved services, provider service management, and
client bookings with authorized booking visibility. The requirements identify
the migration path and services API route required by the assignment.

**Changes accepted:**

- Changed `.gitignore` so `node_modules/` and `.next/` are ignored at any
  directory depth, added `dist/`, and preserved existing ignore rules,
  including `.env*`.
- Created `docs/requirements.md` with three user stories, acceptance criteria,
  size estimates, and migration/API traceability.

**Changes not implemented:** No service update or booking API route was
invented. The assignment specifies the services API `GET` and `POST` handler,
but does not specify a service-update handler or a booking API handler. The
requirements document identifies these as undefined API details rather than
claiming they exist. The documented behavior is a requirement, not evidence
that these features have been implemented.

**Human review:** I checked the story wording and size estimates against the
instructor's rubric and confirmed they align with its requirements. Clarify the
API surface for service updates and booking operations if required by later
implementation work.

**Verification:** Confirmed the branch was `exam/services-booking-eval`.
`git check-ignore` checks passed for root and nested `node_modules/`, `.next/`,
and `dist/`, and for `.env` and `.env.development.local`. Tracked file names
and contents were scanned for common credential patterns; no matches were
found. No local `.env` filenames were found. The requirements document was
checked for three stories, Given/When/Then criteria, size estimates, migration
and services-route references, and the unspecified update/booking handlers.
`git diff --check` passed. No secret values were displayed.

**Limitations:** Lint, TypeScript, and production build checks were not run
because these changes concern Git ignore rules and documentation.

**Commit status:** No commit or push was made for Parts 1 and 2. At the time
of this entry, the latest commit was `9106999` (`Add midterm exam progress`);
the `.gitignore` and `docs/requirements.md` changes were uncommitted.

## CIS 3610 Midterm Version B — Part 3, 2026-11-06

**Task:** Create the Supabase database migration for the Neighborhood Listing
Platform.

**AI assistance:** AI assistance reviewed the project structure and produced a
Supabase SQL migration containing five related tables: `profiles`,
`service_categories`, `services`, `service_category_mappings`, and `bookings`.
The migration includes primary and foreign keys, constraints, indexes,
time-zone-aware timestamp columns, and `updated_at` triggers.

**Changes accepted:** Created
`supabase/migrations/20261029140000_exam_services_persistence.sql`.

**Changes not implemented:** Row-Level Security policies were not included
because they are reserved for Part 4. No API functionality was implemented.

**Human review:** I reviewed the assignment requirements and database structure before allowing Copilot to continue with the implementation. I checked that the proposed tables, relationships, and fields aligned with the requirements. I used Copilot to assist with the implementation, but reviewed its proposed work before moving forward.

**Verification:** Static checks confirmed that the migration declares all five
required tables and expected relationships, timestamp defaults, and update
triggers. A trailing-whitespace check passed. A scan found no common credential
patterns in the migration.

**Limitations:** The migration was not executed against PostgreSQL or a live
Supabase database. `psql` and the Supabase CLI were unavailable, so successful
database execution has not been confirmed.

**Commit status:** No commit or push was performed for Part 3.


## CIS 3610 Midterm Version B — Part 4, 2026-11-06

**Task:** Implement and review Row-Level Security (RLS) policies for the Local Services & Bookings subsystem.

**AI tool:** Copilot SDK in VS Code.

**AI assistance:** Copilot reviewed the existing database migrations and security policies, investigated a service-category mapping access issue, and created an additional migration for provider access to their own draft or suspended service mappings.

**Changes accepted:**
- Created the RLS migration.
- Added a forward migration for provider mapping reads.
- Expanded the RLS test script to include 22 security scenarios.
- Added the `test:rls` command to `package.json`.
- Updated `docs/security-audit.md`.

**Human review:** I reviewed Copilot's findings and examined the proposed security changes before deciding how to proceed. I also reviewed the reported test results and identified which scenarios still needed testing.

**Verification:**
- Lint passed.
- TypeScript check passed.
- Production build passed.
- JavaScript syntax check passed.
- Seven security scenarios passed.
- Fifteen security scenarios were blocked.
- Zero failures were reported.

**Limitations:** The new migration has not been applied to the live database. The remaining security scenarios have not been completed. No database write tests were executed during the reported test run.

**Commit status:** No commit or push was made for Part 4 at the time of this entry.
