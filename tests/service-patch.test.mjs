import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Replace the server client before importing the real handler. No environment
// configuration, Next.js cookies, or network clients are loaded by these tests.
const mockUrl = "neighborhood-test:supabase";
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase-server") {
      return { url: mockUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/exam-schemas") {
      return {
        url: new URL("../src/lib/exam-schemas.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === mockUrl) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          let state;
          export function configure(value) { state = value; }
          export function getSupabaseConfig() { return state.config; }
          export async function createRequestSupabaseClient() { return state.client; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});
let PATCH;
let configure;
try {
  ({ PATCH } = await import("../src/app/api/services/[id]/route.ts"));
  ({ configure } = await import(mockUrl));
} finally {
  hooks.deregister();
}

const serviceId = "b1000000-0000-4000-8000-000000000001";
const providerId = "b1000000-0000-4000-8000-000000000002";
const oldCategory = "c1000000-0000-4000-8000-000000000001";
const newCategory = "c1000000-0000-4000-8000-000000000002";
const fields = {
  title: "House Cleaning",
  hourly_rate: 35,
  duration_minutes: 120,
  coverage_radius_miles: 15,
};

function setup(options = {}) {
  const calls = [];
  const mappings = new Set(options.mappings ?? [oldCategory]);
  const savedFields = {};
  const failures = { ...options.failures };
  const client = {
    auth: {
      async getUser() {
        return {
          data: { user: options.user === null ? null : { id: providerId } },
          error: options.authError ?? null,
        };
      },
    },
    from(table) {
      const query = { table, operation: "select", filters: [] };
      const chain = {};
      for (const operation of ["select", "update", "insert", "delete"]) {
        chain[operation] = (value) => {
          if (operation !== "select" || query.operation === "select") {
            query.operation = operation;
            query.value = value;
          }
          return chain;
        };
      }
      for (const filter of ["eq", "in"]) {
        chain[filter] = (column, value) => {
          query.filters.push([filter, column, value]);
          return chain;
        };
      }
      const execute = async () => {
        calls.push(query);
        const failure = failures[`${table}.${query.operation}`];
        if (failure) return { data: null, error: { code: failure } };
        if (table === "profiles") {
          return { data: { role: options.role ?? "provider" }, error: null };
        }
        if (table === "service_categories") {
          assert.ok(query.filters.some(([op, column, value]) =>
            op === "eq" && column === "active_status" && value === true));
          return {
            data: (options.activeCategories ?? [oldCategory, newCategory])
              .filter((id) => query.filters.some(([op, column, values]) =>
                op === "in" && column === "id" && values.includes(id)))
              .map((id) => ({ id })),
            error: null,
          };
        }
        if (table === "services") {
          assert.deepEqual(query.filters, [
            ["eq", "id", serviceId],
            ["eq", "provider_id", providerId],
            ["in", "status", ["draft", "suspended"]],
          ]);
          if (options.serviceMissing) return { data: null, error: null };
          if (query.operation === "update") {
            assert.equal(Object.hasOwn(query.value, "category_ids"), false);
            Object.assign(savedFields, query.value);
          }
          return { data: { id: serviceId, ...fields, status: "draft" }, error: null };
        }
        assert.equal(table, "service_category_mappings");
        if (query.operation === "insert") {
          for (const row of query.value) {
            assert.equal(row.service_id, serviceId);
            assert.equal(mappings.has(row.category_id), false);
            mappings.add(row.category_id);
          }
        } else {
          assert.ok(query.filters.some(([op, column, value]) =>
            op === "eq" && column === "service_id" && value === serviceId));
          if (query.operation === "delete") {
            const ids = query.filters.find(([op, column]) =>
              op === "in" && column === "category_id")?.[2];
            assert.ok(ids, "Delete must target only obsolete category IDs");
            if (options.deleteFiltered) return { data: [], error: null };
            ids.forEach((id) => mappings.delete(id));
            return { data: ids.map((category_id) => ({ category_id })), error: null };
          }
        }
        return { data: [...mappings].map((category_id) => ({ category_id })), error: null };
      };
      chain.maybeSingle = execute;
      chain.then = (resolve, reject) => execute().then(resolve, reject);
      return chain;
    },
  };
  configure({ config: options.config === null ? null : {}, client });
  return { calls, mappings, savedFields };
}

function request(body) {
  return PATCH(new Request("http://local.test/api/services/" + serviceId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: serviceId }) });
}

test("PATCH updates only service columns and preserves omitted categories", async () => {
  const state = setup();
  const response = await request(fields);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service.id, serviceId);
  assert.deepEqual(state.savedFields, fields);
  assert.deepEqual([...state.mappings], [oldCategory]);
  assert.equal(state.calls.some((call) => call.table.includes("categor")), false);
});

test("PATCH replaces categories by inserting additions before deleting removals", async () => {
  const state = setup();
  assert.equal((await request({ ...fields, category_ids: [newCategory] })).status, 200);
  assert.deepEqual([...state.mappings], [newCategory]);
  const writes = state.calls.filter((call) => call.table === "service_category_mappings"
    && call.operation !== "select");
  assert.deepEqual(writes.map((call) => call.operation), ["insert", "delete"]);
  assert.deepEqual(writes[0].value, [{ service_id: serviceId, category_id: newCategory }]);
});

test("PATCH explicitly empty categories clears mappings", async () => {
  const state = setup();
  assert.equal((await request({ ...fields, category_ids: [] })).status, 200);
  assert.equal(state.mappings.size, 0);
  assert.equal(state.calls.some((call) => call.operation === "insert"), false);
});

test("PATCH keeps unchanged categories without rewriting mappings", async () => {
  const state = setup();
  assert.equal((await request({ ...fields, category_ids: [oldCategory] })).status, 200);
  assert.equal(state.calls.some((call) => ["insert", "delete"].includes(call.operation)), false);
});

test("PATCH accepts uppercase UUIDs without duplicating existing mappings", async () => {
  const state = setup();
  assert.equal((await request({ ...fields, category_ids: [oldCategory.toUpperCase()] })).status, 200);
  assert.deepEqual([...state.mappings], [oldCategory]);
  assert.equal(state.calls.some((call) => ["insert", "delete"].includes(call.operation)), false);
});

test("PATCH rejects nonexistent or inactive categories before writes", async () => {
  const state = setup({ activeCategories: [] });
  assert.equal((await request({ ...fields, category_ids: [newCategory] })).status, 400);
  assert.deepEqual([...state.mappings], [oldCategory]);
  assert.equal(state.calls.some((call) => call.operation !== "select"), false);
});

test("PATCH rejects invalid UUIDs, duplicate categories and invalid service fields", async () => {
  for (const body of [
    { ...fields, category_ids: ["bad-id"] },
    { ...fields, category_ids: [oldCategory, oldCategory] },
    { ...fields, category_ids: null },
    { ...fields, title: "Bad" },
    { ...fields, provider_id: providerId },
  ]) {
    const state = setup();
    assert.equal((await request(body)).status, 400);
    assert.equal(state.calls.length, 0);
  }
});

test("PATCH retains configuration, authentication and provider checks", async () => {
  for (const [options, status] of [
    [{ config: null }, 503],
    [{ user: null }, 401],
    [{ user: null, authError: { status: 401 } }, 401],
    [{ authError: { status: 500 } }, 503],
    [{ role: "admin" }, 403],
    [{ role: "client" }, 403],
    [{ failures: { "profiles.select": "XX000" } }, 500],
  ]) {
    const state = setup(options);
    assert.equal((await request({ ...fields, category_ids: [newCategory] })).status, status);
    assert.equal(state.calls.some((call) => call.operation !== "select"), false);
  }
});

test("PATCH rejects malformed JSON before accessing the database", async () => {
  const state = setup();
  const response = await PATCH(new Request("http://local.test", {
    method: "PATCH", body: "{",
  }), { params: Promise.resolve({ id: serviceId }) });
  assert.equal(response.status, 400);
  assert.equal(state.calls.length, 0);
});

test("PATCH never changes mappings for a missing, unowned or noneditable service", async () => {
  const state = setup({ serviceMissing: true });
  assert.equal((await request({ ...fields, category_ids: [newCategory] })).status, 404);
  assert.equal(state.calls.some((call) => call.table === "service_category_mappings"), false);
  assert.deepEqual([...state.mappings], [oldCategory]);
});

test("PATCH reports preflight and service-update database errors", async () => {
  for (const key of ["service_categories.select", "services.update"]) {
    const state = setup({ failures: { [key]: "XX000" } });
    assert.equal((await request({ ...fields, category_ids: [newCategory] })).status, 500);
    assert.deepEqual([...state.mappings], [oldCategory]);
    assert.equal(state.calls.some((call) => call.table === "service_category_mappings"), false);
  }
});

test("PATCH reports mapping read failures as partial updates", async () => {
  const state = setup({ failures: { "service_category_mappings.select": "XX000" } });
  const response = await request({ ...fields, category_ids: [newCategory] });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /service fields were updated/i);
  assert.deepEqual([...state.mappings], [oldCategory]);
});

test("PATCH maps insertion errors and preserves old mappings when insertion fails", async () => {
  for (const [code, status] of [["23503", 400], ["42501", 403], ["23505", 409], ["XX000", 500]]) {
    const state = setup({ failures: { "service_category_mappings.insert": code } });
    const response = await request({ ...fields, category_ids: [newCategory] });
    assert.equal(response.status, status);
    assert.match((await response.json()).error, /service fields were updated/i);
    assert.deepEqual([...state.mappings], [oldCategory]);
    assert.equal(state.calls.some((call) => call.operation === "delete"), false);
  }
});

test("PATCH reports deletion failure without falsely reporting success", async () => {
  const state = setup({ failures: { "service_category_mappings.delete": "XX000" } });
  const response = await request({ ...fields, category_ids: [newCategory] });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /service fields were updated/i);
  assert.deepEqual([...state.mappings], [oldCategory, newCategory]);
});

test("PATCH reports a conflict when mapping deletes are silently filtered by RLS", async () => {
  const state = setup({ deleteFiltered: true });
  const response = await request({ ...fields, category_ids: [] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /no longer editable/i);
  assert.deepEqual([...state.mappings], [oldCategory]);
});
