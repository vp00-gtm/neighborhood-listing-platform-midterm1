import assert from "node:assert/strict";
import test from "node:test";
import { createReadOnlyFetch, runReadOnlyAudit } from "../scripts/rls-readonly-tests.mjs";

const origin = "https://unit-test.invalid";
test("production audit transport permits table reads and authentication only", async () => {
  const calls = [];
  const guarded = createReadOnlyFetch(origin, async (request, options) => {
    calls.push({ method: request.method, path: new URL(request.url).pathname, redirect: options.redirect });
    return new Response("[]");
  });
  for (const table of ["profiles", "services", "service_categories", "service_category_mappings", "bookings"]) {
    await guarded(`${origin}/rest/v1/${table}?select=id`);
  }
  await guarded(`${origin}/auth/v1/token?grant_type=password`, { method: "POST" });
  await guarded(`${origin}/auth/v1/logout?scope=local`, { method: "POST" });
  assert.equal(calls.length, 7);
  assert.ok(calls.every((c) => c.redirect === "error"));
});

test("production audit transport blocks mutations, RPCs and other origins before sending", async () => {
  let calls = 0;
  const guarded = createReadOnlyFetch(origin, async () => { calls++; return new Response(); });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(guarded(`${origin}/rest/v1/services`, { method }), /blocked/);
    await assert.rejects(guarded(`${origin}/rest/v1/bookings`, { method }), /blocked/);
  }
  for (const path of ["/rest/v1/rpc/unsafe_function", "/auth/v1/admin/users", "/rest/v1/secrets"]) {
    await assert.rejects(guarded(origin + path), /blocked/);
  }
  await assert.rejects(guarded("https://other.invalid/rest/v1/services"), /blocked/);
  await assert.rejects(guarded(`${origin}/auth/v1/token?grant_type=refresh_token`, { method: "POST" }), /blocked/);
  assert.equal(calls, 0);
});

test("network failures do not expose original errors or request details", async () => {
  const guarded = createReadOnlyFetch(origin, async () => { throw Error("private test credential"); });
  await assert.rejects(guarded(`${origin}/rest/v1/services`), (error) => {
    assert.equal(error.message, "Audit network request failed.");
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("audit refuses missing configuration or elevated keys without network access", async () => {
  let calls = 0;
  const noNetwork = async () => { calls++; throw Error("Must not connect"); };
  for (const environment of [{}, { NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_unit-test-only" }]) {
    const report = await runReadOnlyAudit(environment, noNetwork);
    assert.equal(report.results[0].status, "BLOCKED");
  }
  assert.equal(calls, 0);
});

test("read-only audit verifies provider/client privacy without admin credentials or fixed row counts", async () => {
  const jwt = (claims) => `test.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.test`;
  const key = jwt({ role: "anon" });
  const environment = { NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
    RLS_ALLOW_MUTATING_TESTS: "true", SUPABASE_SERVICE_ROLE_KEY: "unused-test-key" };
  const roles = { providerA: "provider", providerB: "provider", clientA: "client", clientB: "client" };
  for (const [label, role] of Object.entries(roles)) {
    const prefix = `${role === "provider" ? "PROVIDER" : "CLIENT"}_${label.endsWith("A") ? "A" : "B"}`;
    environment[`${prefix}_EMAIL`] = `${label}@unit-test.invalid`;
    environment[`${prefix}_PASSWORD`] = "unit-test-input-only";
  }
  const services = [
    { id: "sa", provider_id: "providerA", status: "approved" },
    { id: "da", provider_id: "providerA", status: "draft" },
    { id: "sb", provider_id: "providerB", status: "approved" },
    { id: "db", provider_id: "providerB", status: "suspended" },
  ];
  const bookings = [{ id: "ba1", service_id: "sa" }, { id: "ba2", service_id: "sa" }, { id: "bb1", service_id: "sb" }];
  const mappings = services.map((s) => ({ service_id: s.id, category_id: "test-category" }));
  const tableRequests = [];
  const fakeNetwork = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/auth/v1/token") {
      const label = (await request.json()).email.split("@")[0];
      return Response.json({ access_token: jwt({ sub: label, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
        refresh_token: "unit-test-refresh", token_type: "bearer", expires_in: 3600,
        user: { id: label, aud: "authenticated", role: "authenticated" } });
    }
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    tableRequests.push(request.method);
    assert.equal(request.headers.get("apikey"), key);
    const token = request.headers.get("authorization").split(" ")[1];
    const label = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
    const ownedIds = new Set(services.filter((s) => s.provider_id === label).map((s) => s.id));
    const publicIds = new Set(services.filter((s) => s.status === "approved").map((s) => s.id));
    const table = url.pathname.split("/").pop();
    if (table === "profiles") return Response.json([{ id: label, role: roles[label] }]);
    if (table === "services") return Response.json(services.filter((s) => roles[label] === "admin" || (label ? ownedIds.has(s.id) : publicIds.has(s.id))));
    if (table === "service_categories") return Response.json([{ id: "test-category", active_status: true }]);
    if (table === "service_category_mappings") return Response.json(mappings.filter((m) => roles[label] === "admin" || (label ? ownedIds : publicIds).has(m.service_id)));
    if (table === "bookings") return Response.json(bookings.filter((b) => roles[label] === "admin" || ownedIds.has(b.service_id)));
    throw Error("Unexpected test request");
  };
  const report = await runReadOnlyAudit(environment, fakeNetwork);
  assert.equal(report.results.filter((r) => r.status === "FAIL").length, 0);
  assert.equal(report.results.filter((r) => r.status === "BLOCKED").length, 4);
  assert.ok(report.results.some((r) => r.name === "Providers: establish existing booking controls" && r.status === "PASS" && r.detail.startsWith("3 existing bookings")));
  for (const label of ["anonymous", "clientA", "clientB"]) {
    assert.ok(report.results.some((r) => r.name === `${label}: no booking read access` && r.status === "PASS"));
  }
  assert.equal(report.writesTested, false);
  assert.ok(tableRequests.length > 0 && tableRequests.every((method) => method === "GET"));
  const output = JSON.stringify(report);
  assert.doesNotMatch(output, /unit-test-input-only|unused-test-key|unit-test-refresh|@unit-test/);

  // The alternate credential label is not authority: a trusted profile role
  // check is still required, and changing the mock role must fail that check.
  environment.UNRELATED_EMAIL = "unrelated@unit-test.invalid";
  environment.UNRELATED_PASSWORD = "unit-test-input-only";
  roles.unrelated = "admin";
  const adminReport = await runReadOnlyAudit(environment, fakeNetwork);
  assert.ok(adminReport.results.every((result) => result.status === "PASS"));
  assert.equal(adminReport.controlSources.bookings, "admin");
  environment.SUPABASE_URL = origin;
  environment.SUPABASE_PUBLISHABLE_KEY = key;
  environment.NEXT_PUBLIC_SUPABASE_URL = "https://ignored-legacy.invalid";
  environment.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_secret_ignored-legacy-test-input";
  const renamedReport = await runReadOnlyAudit(environment, fakeNetwork);
  assert.ok(renamedReport.results.every((result) => result.status === "PASS"));
  roles.unrelated = "client";
  const wrongRoleReport = await runReadOnlyAudit(environment, fakeNetwork);
  assert.ok(wrongRoleReport.results.some((result) => result.name === "admin: authentication and profile role" && result.status === "FAIL"));
  assert.ok(wrongRoleReport.results.some((result) => result.name === "Admin: read existing booking controls" && result.status === "BLOCKED"));
});
