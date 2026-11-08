import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const mockUrl = "neighborhood-test:review-client";
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "@/lib/supabase-server" ? { url: mockUrl, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url === mockUrl ? { format: "module", shortCircuit: true, source: `
      let state;
      export function configure(value) { state = value; }
      export function getSupabaseConfig() { return {}; }
      export async function createRequestSupabaseClient() { return state; }
    ` } : nextLoad(url, context);
  },
});
let PATCH, configure;
try {
  ({ PATCH } = await import("../src/app/api/services/[id]/review/route.ts"));
  ({ configure } = await import(mockUrl));
} finally { hooks.deregister(); }

function setup({ status = "pending", role = "admin", anonymous = false, error = null } = {}) {
  const calls = [];
  configure({
    auth: { getUser: async () => ({ data: { user: anonymous ? null : { id: "test-admin" } }, error: null }) },
    from(table) {
      const call = { table, filters: [] };
      const chain = {
        select() { return chain; },
        update(value) { call.value = value; return chain; },
        eq(...args) { call.filters.push(["eq", ...args]); return chain; },
        in(...args) { call.filters.push(["in", ...args]); return chain; },
        async maybeSingle() {
          calls.push(call);
          if (table === "profiles") return { data: { role }, error: null };
          const allowed = call.filters.find(([method]) => method === "in")[2];
          return { data: allowed.includes(status) ? { id: "test-service", status: call.value.status } : null, error };
        },
      };
      return chain;
    },
  });
  return calls;
}
function review(status) {
  return PATCH(new Request("http://unit-test.invalid", { method: "PATCH", body: JSON.stringify({ status }) }),
    { params: Promise.resolve({ id: "test-service" }) });
}
test("admin can suspend a pending or approved service", async () => {
  for (const status of ["pending", "approved"]) {
    const calls = setup({ status });
    const response = await review("suspended");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { service: { id: "test-service", status: "suspended" } });
    assert.deepEqual(calls[1].filters, [["eq", "id", "test-service"], ["in", "status", ["pending", "approved"]]]);
  }
});
test("only pending services can be approved", async () => {
  setup({ status: "pending" });
  assert.equal((await review("approved")).status, 200);
  for (const status of ["draft", "approved", "suspended"]) {
    setup({ status });
    assert.equal((await review("approved")).status, 409);
  }
});
test("admin suspension rejects draft services", async () => {
  setup({ status: "draft" });
  const response = await review("suspended");
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /pending or approved/);
});
test("anonymous users and non-admins cannot review services", async () => {
  for (const [options, expected] of [[{ anonymous: true }, 401], [{ role: "provider" }, 403], [{ role: "client" }, 403]]) {
    const calls = setup(options);
    assert.equal((await review("suspended")).status, expected);
    assert.ok(calls.every((call) => call.table !== "services"));
  }
});
