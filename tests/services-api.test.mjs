import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Every database response and identity below is a local test fixture. The real
// configuration, SDK, cookies and network are never loaded in this test file.
const clientUrl = "neighborhood-test:services-api-client";
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabaseServer") {
      return { url: clientUrl, shortCircuit: true };
    }
    if (specifier === "@/schemas/service" || specifier === "@/lib/exam-schemas") {
      return {
        url: new URL(specifier === "@/schemas/service"
          ? "../src/schemas/service.ts" : "../src/lib/exam-schemas.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === clientUrl) {
      return {
        format: "module", shortCircuit: true,
        source: `
          let state;
          export function configure(value) { state = value; }
          export function getSupabaseConfig() { return state.config; }
          export async function createRequestSupabaseClient() { return state.requestClient; }
          export function createSupabaseServerClient() {
            state.events.push('privileged-client');
            if (state.options.clientThrows) throw Error('sensitive test error');
            return state.options.missingKey ? null : state.database;
          }
        `,
      };
    }
    return nextLoad(url, context);
  },
});
let GET, POST, serviceSchema, configure;
try {
  ({ GET, POST } = await import("../src/app/api/services/route.ts"));
  ({ serviceSchema } = await import("../src/schemas/service.ts"));
  ({ configure } = await import(clientUrl));
} finally {
  hooks.deregister();
}

const userId = "b1000000-0000-4000-8000-000000000002";
const serviceId = "b1000000-0000-4000-8000-000000000001";
const categoryId = "c1000000-0000-4000-8000-000000000001";
const input = { title: "House Cleaning", hourly_rate: 35, duration_minutes: 120, coverage_radius_miles: 15 };
const persisted = { id: serviceId, provider_id: userId, ...input, status: "draft", created_at: "2026-01-01T00:00:00Z" };

function setup(options = {}) {
  const calls = [];
  const events = [];
  function builder(table, privileged) {
    const query = { table, privileged, operation: "select", filters: [] };
    const chain = {};
    chain.overrideTypes = () => chain;
    for (const operation of ["select", "insert", "delete"]) {
      chain[operation] = (value) => {
        if (operation === "select") query.columns = value;
        else { query.operation = operation; query.value = value; }
        return chain;
      };
    }
    for (const method of ["eq", "in", "order"]) {
      chain[method] = (...args) => { query.filters.push([method, ...args]); return chain; };
    }
    async function execute() {
      calls.push(query);
      events.push(`${table}.${query.operation}`);
      const failure = options.failures?.[`${table}.${query.operation}`];
      if (failure === "throw") throw Error("sensitive test error");
      if (failure) return { data: null, error: { code: failure, message: "sensitive test error" } };
      if (table === "profiles") {
        assert.equal(privileged, false, "Role lookup must use the authenticated caller");
        assert.equal(query.columns, "role");
        assert.deepEqual(query.filters, [["eq", "id", userId]]);
        return { data: options.noProfile ? null : { role: options.role ?? "provider" }, error: null };
      }
      assert.equal(privileged, table === "services" && query.operation === "select",
        "Only public GET may use the privileged client; all POST operations must use the provider session");
      if (table === "services") {
        if (query.operation === "select") return { data: options.services ?? [], error: null };
        if (query.operation === "insert") return { data: options.noPersistedRecord ? null : persisted, error: null };
        return { data: null, error: null };
      }
      if (table === "service_categories") {
        assert.deepEqual(query.filters, [["in", "id", [categoryId]], ["eq", "active_status", true]]);
        return { data: options.invalidCategory ? [] : [{ id: categoryId }], error: null };
      }
      assert.equal(table, "service_category_mappings");
      return { data: null, error: null };
    }
    chain.single = execute;
    chain.maybeSingle = execute;
    chain.then = (resolve, reject) => execute().then(resolve, reject);
    return chain;
  }
  const requestClient = {
    auth: { async getUser() {
      events.push("authenticate");
      if (options.authThrows) throw Error("sensitive test error");
      return { data: { user: options.anonymous ? null : { id: userId } }, error: options.authError ?? null };
    } },
    from: (table) => builder(table, false),
  };
  const database = { from: (table) => builder(table, true) };
  configure({ config: options.noConfig ? null : {}, requestClient, database, events, options });
  return { calls, events };
}

function post(body = input) {
  return POST(new Request("http://unit-test.invalid/api/services", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

test("Part 5 service schema enforces boundaries, numbers and strict field allowlist", () => {
  assert.equal(serviceSchema.safeParse({ ...input, title: " abcde ", hourly_rate: 0, duration_minutes: 15, coverage_radius_miles: 1 }).success, true);
  for (const patch of [
    { title: "abcd" }, { title: "     " }, { hourly_rate: -0.01 }, { hourly_rate: Infinity },
    { hourly_rate: "35" }, { duration_minutes: 14 }, { duration_minutes: 15.5 },
    { coverage_radius_miles: 0 }, { coverage_radius_miles: -1 },
    { provider_id: userId }, { status: "approved" }, { unexpected: true },
    { category_ids: ["invalid-uuid"] },
  ]) assert.equal(serviceSchema.safeParse({ ...input, ...patch }).success, false);
});

test("GET uses only public columns, approved filter, and newest-first ordering", async () => {
  const state = setup();
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { services: [] });
  assert.deepEqual(state.events, ["privileged-client", "services.select"]);
  assert.equal(state.calls[0].columns,
    "id, title, description, hourly_rate, duration_minutes, coverage_radius_miles, created_at, service_category_mappings(category:service_categories(id, name, slug, active_status))");
  assert.deepEqual(state.calls[0].filters, [["eq", "status", "approved"], ["order", "created_at", { ascending: false }]]);
});

test("GET removes inactive/null categories without removing uncategorized services", async () => {
  const category = { id: categoryId, name: "Test category", slug: "test", active_status: true };
  const service = { id: serviceId, ...input, description: null, created_at: persisted.created_at,
    service_category_mappings: [{ category }, { category: { ...category, active_status: false } }, { category: null }] };
  setup({ services: [service, { ...service, service_category_mappings: [] }] });
  const response = await GET();
  assert.equal(response.status, 200);
  const { services } = await response.json();
  assert.equal(services.length, 2);
  assert.deepEqual(services[0].service_category_mappings, [{ category }]);
  assert.deepEqual(services[1].service_category_mappings, []);
});

test("GET handles missing server configuration and sanitizes database/thrown errors", async () => {
  for (const [options, status] of [
    [{ missingKey: true }, 503], [{ failures: { "services.select": "42703" } }, 500],
    [{ failures: { "services.select": "throw" } }, 500], [{ clientThrows: true }, 500],
  ]) {
    setup(options);
    const response = await GET();
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /sensitive|42703/);
  }
});

test("POST returns structured 400s and never authenticates or writes invalid input", async () => {
  for (const body of [{ ...input, provider_id: userId }, { ...input, status: "approved" }, { ...input, title: "bad" }]) {
    const state = setup();
    const response = await post(body);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(typeof payload.error, "string");
    assert.ok(payload.issues.length > 0);
    assert.equal(typeof payload.issues[0].field, "string");
    assert.equal(state.events.length, 0);
  }
  const state = setup();
  const response = await POST(new Request("http://unit-test.invalid", { method: "POST", body: "{" }));
  assert.equal(response.status, 400);
  assert.equal(state.events.length, 0);
});

test("POST requires a verified cookie user and provider role before database writes", async () => {
  for (const [options, status] of [
    [{ noConfig: true }, 503], [{ anonymous: true }, 401],
    [{ authError: { status: 400, name: "AuthSessionMissingError" } }, 401],
    [{ authError: { status: 401 } }, 401], [{ authError: { status: 403 } }, 401],
    [{ authError: { status: 500 } }, 503], [{ authThrows: true }, 500],
    [{ noProfile: true }, 409], [{ role: "admin" }, 403], [{ role: "client" }, 403], [{ role: "merchant" }, 403],
    [{ failures: { "profiles.select": "XX000" } }, 500],
  ]) {
    const state = setup(options);
    const response = await post();
    assert.equal(response.status, status);
    assert.equal(state.events.includes("privileged-client"), false);
    assert.equal(state.calls.some((call) => call.operation === "insert"), false);
    assert.doesNotMatch(await response.text(), /sensitive|XX000/);
  }
});

test("POST persists a draft owned by the verified user and returns the saved record", async () => {
  const state = setup();
  const response = await post({ ...input, title: "  House Cleaning  " });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { service: persisted });
  assert.deepEqual(state.events, ["authenticate", "profiles.select", "services.insert"]);
  const insert = state.calls.find((call) => call.operation === "insert");
  assert.deepEqual(insert.value, { ...input, provider_id: userId });
  assert.equal(Object.hasOwn(insert.value, "status"), false,
    "Use the trusted draft default; providers have no INSERT grant on status");
  assert.equal(insert.columns, "id, provider_id, title, hourly_rate, duration_minutes, coverage_radius_miles, status, created_at");
});

test("POST preserves optional category assignments after checking active category IDs", async () => {
  const state = setup();
  assert.equal((await post({ ...input, category_ids: [categoryId] })).status, 201);
  assert.deepEqual(state.events, ["authenticate", "profiles.select", "service_categories.select", "services.insert", "service_category_mappings.insert"]);
  const mapping = state.calls.find((call) => call.table === "service_category_mappings");
  assert.deepEqual(mapping.value, [{ service_id: serviceId, category_id: categoryId }]);
});

test("POST rejects inactive/missing categories and category lookup errors before writes", async () => {
  for (const [options, status] of [
    [{ invalidCategory: true }, 400], [{ failures: { "service_categories.select": "XX000" } }, 500],
  ]) {
    const state = setup(options);
    assert.equal((await post({ ...input, category_ids: [categoryId] })).status, status);
    assert.equal(state.calls.some((call) => call.operation === "insert"), false);
  }
});

test("POST sanitizes insert errors and refuses a success without a persisted record", async () => {
  for (const [options, status] of [
    [{ noPersistedRecord: true }, 500],
    ...[["42501", 403], ["23503", 409], ["23505", 409], ["23514", 400], ["XX000", 500], ["throw", 500]]
      .map(([code, status]) => [{ failures: { "services.insert": code } }, status]),
  ]) {
    setup(options);
    const response = await post();
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /sensitive|42501|23503|23505|23514|XX000/);
  }
});

test("POST never creates a service-role client, including when its configuration is unavailable", async () => {
  const state = setup({ missingKey: true, clientThrows: true });
  assert.equal((await post({ ...input, category_ids: [categoryId] })).status, 201);
  assert.equal(state.events.includes("privileged-client"), false);
  assert.ok(state.calls.every((call) => call.privileged === false));
});

test("POST scopes cleanup to the new owned draft when category assignment fails", async () => {
  for (const cleanupFails of [false, true]) {
    const state = setup({ failures: {
      "service_category_mappings.insert": "23503",
      ...(cleanupFails ? { "services.delete": "XX000" } : {}),
    } });
    const response = await post({ ...input, category_ids: [categoryId] });
    assert.equal(response.status, 500);
    assert.deepEqual(state.calls.find((call) => call.operation === "delete").filters,
      [["eq", "id", serviceId], ["eq", "provider_id", userId], ["eq", "status", "draft"]]);
    assert.match((await response.json()).error, cleanupFails ? /draft was created/ : /draft was removed/);
  }
});

test("privileged client requires server configuration and never persists a user session", async () => {
  const sdkUrl = "neighborhood-test:privileged-sdk";
  const markerUrl = "neighborhood-test:server-only";
  const helperHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@supabase/supabase-js") return { url: sdkUrl, shortCircuit: true };
      if (specifier === "server-only") return { url: markerUrl, shortCircuit: true };
      if (specifier === "@/lib/supabase-server") return { url: clientUrl, shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === markerUrl) return { format: "module", shortCircuit: true, source: "export {};" };
      if (url === sdkUrl) return {
        format: "module", shortCircuit: true,
        source: "export const calls = []; export function createClient(...args) { calls.push(args); return { testClient: true }; }",
      };
      return nextLoad(url, context);
    },
  });
  let createSupabaseServerClient, calls;
  try {
    ({ createSupabaseServerClient } = await import("../src/lib/supabaseServer.ts"));
    ({ calls } = await import(sdkUrl));
  } finally {
    helperHooks.deregister();
  }

  // Replace the environment object temporarily: no real environment values or
  // .env files are read. These values exist only as synthetic unit-test inputs.
  const previousEnvironment = process.env;
  try {
    process.env = {};
    assert.equal(createSupabaseServerClient(), null);
    process.env = { NEXT_PUBLIC_SUPABASE_URL: "https://unit-test.invalid" };
    assert.equal(createSupabaseServerClient(), null);
    process.env = { SUPABASE_SERVICE_ROLE_KEY: "unit-test-only-not-a-credential" };
    assert.equal(createSupabaseServerClient(), null);
    assert.equal(calls.length, 0);
    process.env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://unit-test.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "unit-test-only-not-a-credential",
    };
    assert.deepEqual(createSupabaseServerClient(), { testClient: true });
    assert.deepEqual(calls, [["https://unit-test.invalid", "unit-test-only-not-a-credential", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }]]);
  } finally {
    process.env = previousEnvironment;
  }
});
