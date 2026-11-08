import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const accountVariables = {
  admin: ["ADMIN_EMAIL", "ADMIN_PASSWORD", "admin"],
  providerA: ["PROVIDER_A_EMAIL", "PROVIDER_A_PASSWORD", "provider"],
  providerB: ["PROVIDER_B_EMAIL", "PROVIDER_B_PASSWORD", "provider"],
  clientA: ["CLIENT_A_EMAIL", "CLIENT_A_PASSWORD", "client"],
  clientB: ["CLIENT_B_EMAIL", "CLIENT_B_PASSWORD", "client"],
};
const tables = new Set(["profiles", "services", "service_categories", "service_category_mappings", "bookings"]);

// Enforce read-only table access independently of any mutation opt-in settings.
// Authentication POSTs create/end test sessions; no application-table writes,
// RPCs, SQL, redirects, or requests to another host are allowed.
export function createReadOnlyFetch(origin, fetchImplementation = fetch) {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    const tableRead = request.method === "GET" && tables.has(table);
    const signIn = request.method === "POST" && url.pathname === "/auth/v1/token"
      && url.searchParams.get("grant_type") === "password";
    const signOut = request.method === "POST" && url.pathname === "/auth/v1/logout";
    if (url.origin !== origin || !(tableRead || signIn || signOut)) {
      throw new Error("Read-only audit blocked an unsupported operation.");
    }
    try {
      return await fetchImplementation(request, {
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      });
    } catch {
      // Never propagate request headers, URLs, bodies, or original SDK details.
      throw new Error("Audit network request failed.");
    }
  };
}

class BlockedCheck extends Error {}
function assert(condition, message) { if (!condition) throw new Error(message); }
function isPublicKey(key) {
  if (key.startsWith("sb_publishable_")) return true;
  try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; }
  catch { return false; }
}

export async function runReadOnlyAudit(environment, fetchImplementation = fetch) {
  const results = [];
  const sessions = new Map();
  const verifiedRoles = new Set();
  async function check(name, run) {
    try {
      const detail = await run();
      results.push({ name, status: "PASS", detail: detail ?? "Expected visibility verified." });
    } catch (error) {
      results.push({ name, status: error instanceof BlockedCheck ? "BLOCKED" : "FAIL",
        detail: error instanceof Error ? error.message : "Unexpected audit failure." });
    }
  }
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const key = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { mode: "read-only", results: [{ name: "Public configuration", status: "BLOCKED",
      detail: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required." }] };
  }
  let origin;
  try { origin = new URL(url).origin; }
  catch {
    return { mode: "read-only", results: [{ name: "Public configuration", status: "BLOCKED", detail: "Configured project URL is invalid." }] };
  }
  if (!isPublicKey(key)) {
    return { mode: "read-only", results: [{ name: "Public configuration", status: "BLOCKED",
      detail: "Audit requires an anon JWT or publishable key; elevated keys are not accepted." }] };
  }
  if (environment.RLS_EXPECTED_PROJECT_REF
      && new URL(url).hostname.split(".")[0] !== environment.RLS_EXPECTED_PROJECT_REF) {
    return { mode: "read-only", results: [{ name: "Project guard", status: "BLOCKED",
      detail: "Configured project does not match RLS_EXPECTED_PROJECT_REF." }] };
  }

  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createReadOnlyFetch(origin, fetchImplementation) } };
  const anon = createClient(url, key, options);
  function session(label) {
    if (!sessions.has(label) || !verifiedRoles.has(label)) throw new BlockedCheck(`Verified ${label} session unavailable.`);
    return sessions.get(label);
  }
  async function rows(client, table, columns, filters = []) {
    let query = client.from(table).select(columns);
    for (const [column, value] of filters) query = query.eq(column, value);
    const { data, error } = await query;
    if (error) {
      if (!error.code || error.code === "PGRST301") throw new BlockedCheck("Read request failed: connectivity or session could not be verified.");
      throw new Error(`Read request failed (${/^[A-Z0-9]+$/.test(error.code) ? error.code : "database error"}).`);
    }
    if ((data?.length ?? 0) >= 1000) throw new BlockedCheck("Result may be truncated; pagination is needed before comparing visibility.");
    return data ?? [];
  }
  const ids = (data) => data.map((row) => row.id).sort();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // The student identifies the existing "unrelated" account as their admin.
  // An alias selects credentials only; the profile must still prove admin role.
  const configuredAccounts = { ...accountVariables };
  if (!(environment.ADMIN_EMAIL && environment.ADMIN_PASSWORD)
      && environment.UNRELATED_EMAIL && environment.UNRELATED_PASSWORD) {
    configuredAccounts.admin = ["UNRELATED_EMAIL", "UNRELATED_PASSWORD", "admin"];
  }
  let services, bookings, mappings;
  const controlSources = {};
  function providers() {
    return [session("providerA"), session("providerB")];
  }
  try {
    await Promise.all(Object.entries(configuredAccounts).map(async ([label, [emailName, passwordName, expectedRole]]) => {
      await check(`${label}: authentication and profile role`, async () => {
        if (!environment[emailName] || !environment[passwordName]) throw new BlockedCheck(`Missing ${emailName} or ${passwordName}; no values displayed.`);
        const client = createClient(url, key, options);
        const { data, error } = await client.auth.signInWithPassword({ email: environment[emailName], password: environment[passwordName] });
        if (error || !data.user?.id) throw new BlockedCheck(`Sign-in unavailable${error?.status ? ` (HTTP ${error.status})` : ""}; no account details displayed.`);
        sessions.set(label, { client, id: data.user.id });
        const profiles = await rows(client, "profiles", "id, role", [["id", data.user.id]]);
        assert(profiles.length === 1 && profiles[0].role === expectedRole, "Authenticated profile does not have the expected test role.");
        verifiedRoles.add(label);
      });
    }));

    await check("Admin: read service controls", async () => {
      services = await rows(session("admin").client, "services", "id, provider_id, status");
      assert(services.length > 0, "No service controls are available.");
      controlSources.services = "admin";
      return `${services.length} services visible to the authenticated admin.`;
    });
    if (!services?.length) {
      await check("Providers: establish owned service controls", async () => {
        const controls = [];
        for (const provider of providers()) {
          const owned = await rows(provider.client, "services", "id, provider_id, status");
          assert(owned.every((s) => s.provider_id === provider.id), "Provider service query exposed another owner's record.");
          controls.push(...owned);
        }
        if (!controls.length) throw new BlockedCheck("No provider-owned service controls are available.");
        services = controls;
        controlSources.services = "verified provider sessions";
        return `${controls.length} existing services established through their owners; this is not an admin-wide inventory.`;
      });
    }
    function serviceControls() {
      if (!services?.length) throw new BlockedCheck("Admin service controls unavailable.");
      return services;
    }
    await check("Anonymous: approved services visible, private services hidden", async () => {
      const controls = serviceControls();
      const approved = controls.filter((s) => s.status === "approved");
      const drafts = controls.filter((s) => s.status === "draft");
      if (!approved.length || !drafts.length) throw new BlockedCheck("Both approved and draft controls are required.");
      const visible = await rows(anon, "services", "id, status");
      const visibleIds = new Set(ids(visible));
      assert(visible.every((s) => s.status === "approved") && approved.every((s) => visibleIds.has(s.id)), "Anonymous service visibility differs from the approved control set.");
      if (controlSources.services === "admin") assert(same(ids(visible), ids(approved)), "Anonymous approved service results differ from the complete admin control set.");
      return `${visible.length} approved services visible; ${controls.length - approved.length} verified non-approved controls hidden.`;
    });
    await check("Anonymous: active categories visible", async () => {
      const categories = await rows(anon, "service_categories", "id, active_status");
      if (!categories.length) throw new BlockedCheck("No active category control is available.");
      assert(categories.every((c) => c.active_status === true), "An inactive category was exposed.");
      return `${categories.length} visible categories; all active. Existence of hidden inactive categories was not independently established.`;
    });
    await check("Admin: read mapping controls", async () => {
      mappings = await rows(session("admin").client, "service_category_mappings", "service_id, category_id");
      controlSources.mappings = "admin";
      return `${mappings.length} mappings visible to the authenticated admin.`;
    });
    if (!mappings) {
      await check("Providers: establish owned mapping controls", async () => {
        const controls = [];
        for (const provider of providers()) {
          const ownedIds = new Set(serviceControls().filter((s) => s.provider_id === provider.id).map((s) => s.id));
          const owned = await rows(provider.client, "service_category_mappings", "service_id, category_id");
          assert(owned.every((m) => ownedIds.has(m.service_id)), "Provider mapping query exposed another owner's record.");
          controls.push(...owned);
        }
        mappings = controls;
        controlSources.mappings = "verified provider sessions";
        return `${controls.length} existing mappings established through service owners.`;
      });
    }
    await check("Anonymous: only approved-service mappings visible", async () => {
      const controls = serviceControls();
      if (!mappings) throw new BlockedCheck("Admin mapping controls unavailable.");
      const approved = new Set(controls.filter((s) => s.status === "approved").map((s) => s.id));
      const pairs = (items) => items.map((m) => `${m.service_id}:${m.category_id}`).sort();
      const expected = mappings.filter((m) => approved.has(m.service_id));
      if (!expected.length || expected.length === mappings.length) throw new BlockedCheck("Both public and private mapping controls are required.");
      const visible = await rows(anon, "service_category_mappings", "service_id, category_id");
      const serviceIds = new Set(controls.map((s) => s.id));
      const scoped = controlSources.mappings === "admin" ? visible : visible.filter((m) => serviceIds.has(m.service_id));
      assert(same(pairs(scoped), pairs(expected)), "Anonymous mapping visibility differs from approved-service controls.");
      return "Public/private mapping visibility verified against the established service controls.";
    });
    for (const label of ["providerA", "providerB"]) {
      await check(`${label}: only owned services visible`, async () => {
        const controls = serviceControls();
        const provider = session(label);
        const expected = controls.filter((s) => s.provider_id === provider.id);
        if (!expected.length || expected.length === controls.length) throw new BlockedCheck("Both owned and other-provider controls are required.");
        const visible = await rows(provider.client, "services", "id, provider_id");
        assert(visible.every((s) => s.provider_id === provider.id) && same(ids(visible), ids(expected)), "Provider service ownership isolation failed.");
      });
      await check(`${label}: owned mappings include approved services`, async () => {
        const provider = session(label);
        const owned = serviceControls().filter((s) => s.provider_id === provider.id);
        if (!mappings) throw new BlockedCheck("Admin mapping controls unavailable.");
        const ownedIds = new Set(owned.map((s) => s.id));
        const expected = mappings.filter((m) => ownedIds.has(m.service_id));
        if (!expected.some((m) => owned.some((s) => s.id === m.service_id && s.status === "approved"))) throw new BlockedCheck("Owned approved-service mapping control is missing.");
        const pairs = (items) => items.map((m) => `${m.service_id}:${m.category_id}`).sort();
        const visible = await rows(provider.client, "service_category_mappings", "service_id, category_id");
        assert(same(pairs(visible), pairs(expected)), "Provider mapping visibility differs from the owned control set.");
      });
    }
    await check("Admin: read existing booking controls", async () => {
      bookings = await rows(session("admin").client, "bookings", "id, service_id");
      if (!bookings.length) throw new BlockedCheck("No existing bookings are available as privacy controls.");
      controlSources.bookings = "admin";
      return `${bookings.length} existing bookings visible; contact information and notes were not requested.`;
    });
    if (!bookings?.length) {
      await check("Providers: establish existing booking controls", async () => {
        const controls = [];
        for (const provider of providers()) {
          const ownedIds = new Set(serviceControls().filter((s) => s.provider_id === provider.id).map((s) => s.id));
          const owned = await rows(provider.client, "bookings", "id, service_id");
          assert(owned.every((b) => ownedIds.has(b.service_id)), "Provider booking query exposed another owner's record.");
          controls.push(...owned);
        }
        if (!controls.length) throw new BlockedCheck("No existing bookings are available as privacy controls.");
        bookings = controls;
        controlSources.bookings = "verified provider sessions";
        return `${controls.length} existing bookings established through service owners; no contact information or notes requested.`;
      });
    }
    for (const label of ["anonymous", "clientA", "clientB"]) {
      await check(`${label}: no booking read access`, async () => {
        if (!bookings?.length) throw new BlockedCheck("Existing booking controls unavailable.");
        const client = label === "anonymous" ? anon : session(label).client;
        const { data, error } = await client.from("bookings").select("id");
        if (error?.code === "42501") return "Permission denied, as required.";
        if (error) throw new BlockedCheck("Could not verify booking denial because the request failed unexpectedly.");
        assert(Array.isArray(data) && data.length === 0, "Booking rows were exposed to a role with no read access.");
        return "Existing booking controls are hidden by RLS.";
      });
    }
    for (const label of ["providerA", "providerB"]) {
      await check(`${label}: only bookings for owned services visible`, async () => {
        const provider = session(label);
        if (!bookings?.length) throw new BlockedCheck("Existing booking controls unavailable.");
        const owned = new Set(serviceControls().filter((s) => s.provider_id === provider.id).map((s) => s.id));
        const expected = bookings.filter((b) => owned.has(b.service_id));
        if (!expected.length || expected.length === bookings.length) throw new BlockedCheck("Both owned and other-provider bookings are required as controls.");
        const visible = await rows(provider.client, "bookings", "id, service_id");
        assert(same(ids(visible), ids(expected)), "Provider booking ownership isolation failed.");
      });
    }
  } finally {
    for (const { client } of sessions.values()) {
      try { await client.auth.signOut({ scope: "local" }); }
      catch { /* In-memory test client is discarded; never log authentication details. */ }
    }
  }
  return { mode: "read-only", results, controlSources, writesTested: false,
    limitations: "Service INSERT/UPDATE/DELETE, booking INSERT and admin write access are not tested in production." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runReadOnlyAudit(process.env);
    for (const result of report.results) console.log(`${result.status} ${result.name}: ${result.detail}`);
    console.log(`RLS_READONLY_RESULT=${JSON.stringify(report)}`);
    process.exitCode = report.results.some((r) => r.status === "FAIL") ? 1
      : report.results.some((r) => r.status === "BLOCKED") ? 2 : 0;
  } catch {
    console.error("BLOCKED read-only audit could not finish; no credentials or request details displayed.");
    process.exitCode = 2;
  }
}
