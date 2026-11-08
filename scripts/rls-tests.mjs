import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const accounts = {
  admin: ["ADMIN_EMAIL", "ADMIN_PASSWORD"],
  providerA: ["PROVIDER_A_EMAIL", "PROVIDER_A_PASSWORD"],
  providerB: ["PROVIDER_B_EMAIL", "PROVIDER_B_PASSWORD"],
  clientA: ["CLIENT_A_EMAIL", "CLIENT_A_PASSWORD"],
  clientB: ["CLIENT_B_EMAIL", "CLIENT_B_PASSWORD"],
};

const knownCategories = {
  active: "a1000000-0000-4000-8000-000000000001",
  inactive: "a1000000-0000-4000-8000-000000000002",
};

class BlockedTest extends Error {}

const missing = [];
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url) missing.push("SUPABASE_URL");
if (!key) missing.push("SUPABASE_PUBLISHABLE_KEY");
for (const pair of Object.values(accounts)) {
  for (const variable of pair) {
    if (!process.env[variable]) missing.push(variable);
  }
}

const projectRef = url ? new URL(url).hostname.split(".")[0] : null;
const expectedProjectRef = process.env.RLS_EXPECTED_PROJECT_REF;
if (!expectedProjectRef) missing.push("RLS_EXPECTED_PROJECT_REF");
if (projectRef && expectedProjectRef && projectRef !== expectedProjectRef) {
  console.error("Blocked: Supabase project does not match RLS_EXPECTED_PROJECT_REF.");
  process.exitCode = 2;
} else if (missing.length) {
  console.error(`Blocked: missing test configuration (${missing.length} required values).`);
  process.exitCode = 2;
} else {
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const anon = createClient(url, key, options);
  const sessions = new Map();
  const failures = [];
  const blocked = [];
  const temporaryServices = [];
  const mutationOptIn =
    process.env.RLS_ALLOW_MUTATING_TESTS === "true" &&
    process.env.RLS_TEST_DISPOSABLE_PROJECT_REF === projectRef;

  function record(label, detail) {
    (detail instanceof BlockedTest ? blocked : failures).push(`${label}: ${detail.message}`);
    console.log(`${detail instanceof BlockedTest ? "BLOCKED" : "FAIL"} ${label}`);
  }

  async function check(label, run) {
    try {
      await run();
      console.log(`PASS ${label}`);
    } catch (error) {
      record(
        label,
        error instanceof Error ? error : new Error("unexpected failure"),
      );
    }
  }

  function requireMutations() {
    if (!mutationOptIn) {
      throw new BlockedTest(
        "requires RLS_ALLOW_MUTATING_TESTS=true and a matching RLS_TEST_DISPOSABLE_PROJECT_REF; these settings do not establish that the database is disposable or isolated",
      );
    }
  }

  function session(label) {
    const found = sessions.get(label);
    if (!found) throw new BlockedTest(`${label} test account is unavailable`);
    return found;
  }

  async function selectRows(client, table, columns, filters = []) {
    let query = client.from(table).select(columns);
    for (const [method, column, value] of filters) {
      query = query[method](column, value);
    }
    const { data, error } = await query;
    if (error) throw new Error(`${table} query failed (${error.code ?? "unknown"})`);
    return data ?? [];
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  async function expectDenied(result, label) {
    if (result.error) {
      assert(
        result.error.code === "42501" ||
          /row-level security|permission denied/i.test(result.error.message ?? ""),
        `${label} returned an unexpected database error (${result.error.code ?? "unknown"})`,
      );
      return;
    }
    assert(
      Array.isArray(result.data) && result.data.length === 0,
      `${label} unexpectedly succeeded`,
    );
  }

  async function fixtureServices() {
    const rows = await selectRows(
      session("admin").client,
      "services",
      "id, provider_id, title, status",
    );
    const byStatus = rows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {});
    assert(rows.length === 4, "expected the four reviewed service fixtures");
    assert(byStatus.approved === 2, "expected two approved service fixtures");
    assert(byStatus.draft === 1, "expected one draft service fixture");
    assert(byStatus.suspended === 1, "expected one suspended service fixture");
    assert(
      rows.every((row) =>
        [session("providerA").id, session("providerB").id].includes(row.provider_id),
      ),
      "a service fixture has an unexpected provider owner",
    );
    return rows;
  }

  async function createDraft(providerLabel, suffix = randomUUID()) {
    requireMutations();
    const provider = session(providerLabel);
    const title = `RLS fixture ${suffix}`;
    const candidate = { owner: providerLabel, title };
    temporaryServices.push(candidate);
    const { data, error } = await provider.client
      .from("services")
      .insert({
        provider_id: provider.id,
        title,
        hourly_rate: 25,
        duration_minutes: 30,
        coverage_radius_miles: 5,
      })
      .select("id, provider_id, title, status")
      .single();
    if (error || !data) {
      throw new Error(`could not create disposable draft (${error?.code ?? "no row"})`);
    }
    Object.assign(candidate, data);
    assert(data.provider_id === provider.id, "draft was not assigned to its authenticated owner");
    assert(data.status === "draft", "provider-created service was not a draft");
    return { ...data, owner: providerLabel };
  }

  async function deleteOwnedDraft(service, providerLabel = service.owner) {
    const provider = session(providerLabel);
    const { data, error } = await provider.client
      .from("services")
      .delete()
      .eq("id", service.id)
      .eq("provider_id", provider.id)
      .in("status", ["draft", "suspended"])
      .select("id");
    if (error || data?.length !== 1) {
      throw new Error(`could not clean up disposable service (${error?.code ?? "no deleted row"})`);
    }
    const index = temporaryServices.findIndex((entry) => entry.id === service.id);
    if (index >= 0) temporaryServices.splice(index, 1);
  }

  async function cleanupTemporaryServices() {
    const problems = [];
    const admin = sessions.get("admin");
    if (temporaryServices.length && !admin) {
      return temporaryServices.map((service) => `cleanup unavailable for temporary service ${service.title}`);
    }

    for (const service of [...temporaryServices].reverse()) {
      let lookup = admin.client
        .from("services")
        .select("id, provider_id, status");
      lookup = service.id
        ? lookup.eq("id", service.id)
        : lookup.eq("title", service.title);
      const { data: rows, error: readError } = await lookup;
      if (readError) {
        problems.push(`cleanup lookup failed for temporary service ${service.title} (${readError.code ?? "unknown"})`);
        continue;
      }
      if (!rows?.length) {
        const index = temporaryServices.indexOf(service);
        if (index >= 0) temporaryServices.splice(index, 1);
        continue;
      }

      let candidateFailed = false;
      for (const current of rows) {
        const ownerEntry = [...sessions.entries()].find(([, value]) => value.id === current.provider_id);
        if (!ownerEntry || !["providerA", "providerB"].includes(ownerEntry[0])) {
          problems.push(`temporary service ${current.id} has no matching provider session; not deleted`);
          candidateFailed = true;
          continue;
        }
        const ownerLabel = ownerEntry[0];
        if (current.status === "pending") {
          const { error: suspendError, data: suspended } = await admin.client
            .from("services")
            .update({ status: "suspended" })
            .eq("id", current.id)
            .eq("status", "pending")
            .select("id");
          if (suspendError || suspended?.length !== 1) {
            problems.push(`pending temporary service ${current.id} could not be suspended (${suspendError?.code ?? "no updated row"})`);
            candidateFailed = true;
            continue;
          }
        } else if (current.status === "approved") {
          problems.push(`temporary service ${current.id} became approved and cannot be safely reversed or deleted`);
          candidateFailed = true;
          continue;
        } else if (!["draft", "suspended"].includes(current.status)) {
          problems.push(`temporary service ${current.id} has unexpected status and was not deleted`);
          candidateFailed = true;
          continue;
        }

        try {
          await deleteOwnedDraft({ ...service, id: current.id }, ownerLabel);
        } catch (error) {
          problems.push(
            error instanceof Error
              ? `temporary service ${current.id} cleanup failed: ${error.message}`
              : `temporary service ${current.id} cleanup failed`,
          );
          candidateFailed = true;
        }
      }
      if (!candidateFailed) {
        const index = temporaryServices.indexOf(service);
        if (index >= 0) temporaryServices.splice(index, 1);
      }
    }
    if (problems.length) {
      console.error(`Cleanup incomplete for ${problems.length} temporary service record(s):`);
      for (const problem of problems) console.error(`- ${problem}`);
    } else if (temporaryServices.length === 0) {
      console.log("PASS disposable service cleanup");
    }
    return problems;
  }

  async function assertDeniedAndUnchanged(
    result,
    label,
    verifyClient,
    table,
    id,
    expected,
  ) {
    await expectDenied(result, label);
    const { data, error } = await verifyClient
      .from(table)
      .select(Object.keys(expected).join(", "))
      .eq("id", id)
      .single();
    assert(!error && data, `${label} could not verify the original fixture`);
    for (const [field, value] of Object.entries(expected)) {
      assert(data[field] === value, `${label} changed ${field}`);
    }
  }

  try {
    const signInFailures = [];
    for (const [label, [emailKey, passwordKey]] of Object.entries(accounts)) {
      const client = createClient(url, key, options);
      const { data, error } = await client.auth.signInWithPassword({
        email: process.env[emailKey],
        password: process.env[passwordKey],
      });
      if (error || !data.user?.id) {
        signInFailures.push(label);
      } else {
        sessions.set(label, { client, id: data.user.id });
      }
    }

    if (signInFailures.length) {
      console.error(`Blocked: ${signInFailures.length} configured test account(s) could not sign in.`);
      process.exitCode = 2;
    } else {
      let serviceFixtures;
      let bookingFixtures;

    await check("approved service, category, and booking fixtures exist", async () => {
      serviceFixtures = await fixtureServices();
      bookingFixtures = await selectRows(
        session("admin").client,
        "bookings",
        "id, service_id",
      );
      assert(bookingFixtures.length === 2, "expected two reviewed booking fixtures");
      assert(
        bookingFixtures.every((booking) =>
          serviceFixtures.some(
            (service) =>
              service.id === booking.service_id && service.status === "approved",
          ),
        ),
        "booking fixtures must reference approved services",
      );
    });

    if (serviceFixtures && bookingFixtures) {
      await check("profiles have the approved test roles", async () => {
        for (const [label, expected] of [
          ["admin", "admin"],
          ["providerA", "provider"],
          ["providerB", "provider"],
          ["clientA", "client"],
          ["clientB", "client"],
        ]) {
          const { id, client } = session(label);
          const { data, error } = await client
            .from("profiles")
            .select("role")
            .eq("id", id)
            .maybeSingle();
          assert(!error && data?.role === expected, `${label} profile role fixture is incorrect`);
        }
      });

      await check("anonymous users read approved services only", async () => {
        const expected = serviceFixtures
          .filter((service) => service.status === "approved")
          .map((service) => service.id)
          .sort();
        const visible = await selectRows(anon, "services", "id, status");
        assert(expected.length === 2, "expected two approved service fixtures");
        assert(
          visible.every((service) => service.status === "approved"),
          "anonymous query exposed a non-approved service",
        );
        assert(
          JSON.stringify(visible.map((service) => service.id).sort()) ===
            JSON.stringify(expected),
          "anonymous service query did not return exactly the expected approved fixtures",
        );
      });

      await check("anonymous users read active categories only", async () => {
        const active = await anon
          .from("service_categories")
          .select("id, active_status")
          .eq("id", knownCategories.active)
          .maybeSingle();
        assert(!active.error && active.data?.active_status === true, "known active category was not returned");
        const inactive = await anon
          .from("service_categories")
          .select("id")
          .eq("id", knownCategories.inactive);
        assert(!inactive.error && inactive.data?.length === 0, "known inactive category was visible");
        const visible = await selectRows(anon, "service_categories", "id, active_status");
        assert(visible.length === 1, "expected exactly one active category fixture");
        assert(visible.every((category) => category.active_status === true), "inactive category was returned");
      });

      await check("anonymous users read mappings for approved services only", async () => {
        const adminCategories = await selectRows(
          session("admin").client,
          "service_categories",
          "id, active_status",
        );
        const adminMappings = await selectRows(
          session("admin").client,
          "service_category_mappings",
          "service_id, category_id",
        );
        const approvedIds = new Set(
          serviceFixtures
            .filter((service) => service.status === "approved")
            .map((service) => service.id),
        );
        const activeIds = new Set(
          adminCategories
            .filter((category) => category.active_status)
            .map((category) => category.id),
        );
        const expected = adminMappings
          .filter(
            (mapping) =>
              approvedIds.has(mapping.service_id) &&
              activeIds.has(mapping.category_id),
          )
          .map((mapping) => `${mapping.service_id}:${mapping.category_id}`)
          .sort();
        const visible = await selectRows(
          anon,
          "service_category_mappings",
          "service_id, category_id",
        );
        assert(expected.length > 0, "expected at least one approved-service mapping in an active category");
        const visiblePairs = visible
          .map((mapping) => `${mapping.service_id}:${mapping.category_id}`)
          .sort();
        assert(
          JSON.stringify(visiblePairs) === JSON.stringify(expected),
          "anonymous mappings did not exactly match approved-service/active-category mappings",
        );
      });

      await check("providers read only their own services, including approved services", async () => {
        for (const label of ["providerA", "providerB"]) {
          const { id, client } = session(label);
          const expected = serviceFixtures
            .filter((service) => service.provider_id === id)
            .map((service) => service.id)
            .sort();
          assert(expected.length > 0, `${label} has no service fixture`);
          assert(
            serviceFixtures.some(
              (service) => service.provider_id === id && service.status === "approved",
            ),
            `${label} has no approved service fixture`,
          );
          const visible = await selectRows(client, "services", "id, provider_id");
          assert(visible.length > 0, `${label} service query unexpectedly returned no rows`);
          assert(
            visible.every((service) => service.provider_id === id),
            `${label} could read another provider's service`,
          );
          assert(
            JSON.stringify(visible.map((service) => service.id).sort()) ===
              JSON.stringify(expected),
            `${label} could not read exactly their own services`,
          );
        }
      });

      await check("clients cannot read bookings", async () => {
        assert(bookingFixtures.length > 0, "admin fixture query must establish bookings exist");
        const anonymous = await anon.from("bookings").select("id");
        if (anonymous.error) {
          assert(
            anonymous.error.code === "42501" ||
              /row-level security|permission denied/i.test(anonymous.error.message ?? ""),
            `anonymous booking query failed unexpectedly (${anonymous.error.code ?? "unknown"})`,
          );
        } else {
          assert(
            anonymous.data?.length === 0,
            "anonymous visitor received booking rows",
          );
        }
        for (const label of ["clientA", "clientB"]) {
          const { client } = session(label);
          const result = await client.from("bookings").select("id");
          if (result.error) {
            assert(
              result.error.code === "42501" ||
                /row-level security|permission denied/i.test(result.error.message ?? ""),
              `${label} booking query failed unexpectedly (${result.error.code ?? "unknown"})`,
            );
          } else {
            assert(
              result.data?.length === 0,
              `${label} received booking rows despite the no-client-read rule`,
            );
          }
        }
      });

      await check("providers read only bookings for their own services", async () => {
        assert(bookingFixtures.length > 0, "admin fixture query must establish bookings exist");
        for (const label of ["providerA", "providerB"]) {
          const { id, client } = session(label);
          const ownedServiceIds = new Set(
            serviceFixtures
              .filter((service) => service.provider_id === id)
              .map((service) => service.id),
          );
          const expected = bookingFixtures
            .filter((booking) => ownedServiceIds.has(booking.service_id))
            .map((booking) => booking.id)
            .sort();
          assert(expected.length > 0, `${label} has no associated booking fixture`);
          const visible = await selectRows(client, "bookings", "id, service_id");
          assert(visible.length > 0, `${label} booking query unexpectedly returned no rows`);
          assert(
            visible.every((booking) => ownedServiceIds.has(booking.service_id)),
            `${label} could read a booking for another provider's service`,
          );
          assert(
            JSON.stringify(visible.map((booking) => booking.id).sort()) ===
              JSON.stringify(expected),
            `${label} did not receive exactly their associated booking fixtures`,
          );
        }
      });

      await check("admins can read all booking fixtures", async () => {
        const visible = await selectRows(
          session("admin").client,
          "bookings",
          "id, service_id",
        );
        assert(visible.length === bookingFixtures.length && visible.length > 0, "admin could not read every booking fixture");
        assert(
          JSON.stringify(visible.map((booking) => booking.id).sort()) ===
            JSON.stringify(bookingFixtures.map((booking) => booking.id).sort()),
          "admin booking results differ from the expected fixture set",
        );
      });

      await check("providers cannot create services for another provider", async () => {
        requireMutations();
        const providerA = session("providerA");
        const providerB = session("providerB");
        const title = `RLS forged owner ${randomUUID()}`;
        temporaryServices.push({ owner: "providerB", title });
        const result = await providerA.client
          .from("services")
          .insert({
            provider_id: providerB.id,
            title,
            hourly_rate: 20,
            duration_minutes: 30,
            coverage_radius_miles: 5,
          })
          .select("id");
        await expectDenied(result, "provider forged service ownership");
        const persisted = await selectRows(
          session("admin").client,
          "services",
          "id, title",
          [["eq", "title", title]],
        );
        assert(persisted.length === 0, "forged service was created despite the ownership policy");
      });

      await check("providers can update and delete only their own eligible services", async () => {
        requireMutations();
        const own = await createDraft("providerA");
        const updatedTitle = `${own.title} updated`;
        const update = await session("providerA").client
          .from("services")
          .update({ title: updatedTitle })
          .eq("id", own.id)
          .eq("status", "draft")
          .select("id, title, status")
          .single();
        assert(!update.error && update.data?.title === updatedTitle, "provider could not update own draft");
        own.title = updatedTitle;

        const other = await createDraft("providerB");
        const attempted = await session("providerA").client
          .from("services")
          .update({ title: `forged update ${randomUUID()}` })
          .eq("id", other.id)
          .select("id");
        await assertDeniedAndUnchanged(
          attempted,
          "cross-provider service update",
          session("admin").client,
          "services",
          other.id,
          { title: other.title, provider_id: session("providerB").id, status: "draft" },
        );
        const deleteAttempt = await session("providerA").client
          .from("services")
          .delete()
          .eq("id", other.id)
          .select("id");
        await assertDeniedAndUnchanged(
          deleteAttempt,
          "cross-provider service delete",
          session("admin").client,
          "services",
          other.id,
          { title: other.title, provider_id: session("providerB").id, status: "draft" },
        );

        await deleteOwnedDraft(other);
        await deleteOwnedDraft(own);
        const remaining = await selectRows(
          session("admin").client,
          "services",
          "id",
          [["eq", "id", own.id]],
        );
        assert(remaining.length === 0, "deleted draft still exists");
      });

      await check("providers can submit drafts but cannot approve their own services", async () => {
        requireMutations();
        const pending = await createDraft("providerA");
        const submitted = await session("providerA").client
          .from("services")
          .update({ status: "pending" })
          .eq("id", pending.id)
          .eq("status", "draft")
          .select("id, status")
          .single();
        assert(!submitted.error && submitted.data?.status === "pending", "eligible draft could not be submitted");
        pending.status = "pending";

        const providerSuspend = await session("providerA").client
          .from("services")
          .update({ status: "suspended" })
          .eq("id", pending.id)
          .select("id, status");
        await assertDeniedAndUnchanged(
          providerSuspend,
          "provider changed pending status",
          session("admin").client,
          "services",
          pending.id,
          { status: "pending", provider_id: session("providerA").id, title: pending.title },
        );

        const providerPendingEdit = await session("providerA").client
          .from("services")
          .update({ title: `pending edit ${randomUUID()}` })
          .eq("id", pending.id)
          .select("id");
        await assertDeniedAndUnchanged(
          providerPendingEdit,
          "provider edited own pending service",
          session("admin").client,
          "services",
          pending.id,
          { status: "pending", provider_id: session("providerA").id, title: pending.title },
        );

        const providerPendingDelete = await session("providerA").client
          .from("services")
          .delete()
          .eq("id", pending.id)
          .select("id");
        await assertDeniedAndUnchanged(
          providerPendingDelete,
          "provider deleted own pending service",
          session("admin").client,
          "services",
          pending.id,
          { status: "pending", provider_id: session("providerA").id, title: pending.title },
        );

        const adminSuspend = await session("admin").client
          .from("services")
          .update({ status: "suspended" })
          .eq("id", pending.id)
          .eq("status", "pending")
          .select("id, status")
          .single();
        assert(!adminSuspend.error && adminSuspend.data?.status === "suspended", "admin could not suspend pending service");
        pending.status = "suspended";
        const suspendedTitle = `${pending.title} suspended edit`;
        const suspendedUpdate = await session("providerA").client
          .from("services")
          .update({ title: suspendedTitle })
          .eq("id", pending.id)
          .eq("status", "suspended")
          .select("id, title, status")
          .single();
        assert(
          !suspendedUpdate.error &&
            suspendedUpdate.data?.title === suspendedTitle &&
            suspendedUpdate.data.status === "suspended",
          "provider could not edit own suspended service",
        );
        await deleteOwnedDraft(pending);
      });

      await check("providers cannot approve their own services", async () => {
        throw new BlockedTest(
          "an allowed provider approval would permanently change service status and cannot be safely reversed by the test",
        );
      });

      await check("non-admin clients cannot approve services", async () => {
        throw new BlockedTest(
          "an allowed client approval would permanently change service status and cannot be safely reversed by the test",
        );
      });

      await check("providers cannot edit their own approved services", async () => {
        throw new BlockedTest(
          "requires a temporary approved-service fixture; creating one requires an approval transition that is not safely reversible",
        );
      });

      await check("providers cannot delete their own approved services", async () => {
        throw new BlockedTest(
          "requires a temporary approved-service fixture; creating one requires an approval transition that is not safely reversible",
        );
      });

      await check("profile roles cannot be self-assigned", async () => {
        throw new BlockedTest(
          "requires a disposable Auth user/profile fixture and reliable deletion or transaction rollback; existing profiles are never mutation targets",
        );
      });
    } else {
      console.error("Blocked: required reviewed service/booking fixtures were not verified.");
      process.exitCode = 2;
    }

    await check("anonymous and authenticated booking inserts", async () => {
      throw new BlockedTest(
        "a successful insert creates a persistent booking, and the exam intentionally grants no booking DELETE; requires a database transaction/rollback fixture or separately disposable database teardown",
      );
    });

    await check("booking inserts for non-approved services are rejected", async () => {
      throw new BlockedTest(
        "testing insert rejection requires a successful insert control and a disposable booking transaction; no safe REST rollback or booking DELETE is configured",
      );
    });

    await check("admin approval transition", async () => {
      throw new BlockedTest(
        "admin approval is irreversible under the allowed status transitions and service DELETE policy; requires a transaction/rollback fixture or disposable database teardown",
      );
    });

    }
  } finally {
    let cleanupProblems = [];
    try {
      cleanupProblems = await cleanupTemporaryServices();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unexpected cleanup failure";
      console.error(`Cleanup failed unexpectedly: ${detail}`);
      for (const service of temporaryServices) {
        console.error(`- temporary service may remain: ${service.id ?? service.title}`);
      }
      process.exitCode = 1;
    }
    if (cleanupProblems.length) process.exitCode = 1;
  }

  if (failures.length) {
    console.error(`${failures.length} RLS check(s) failed; ${blocked.length} were blocked.`);
    process.exitCode = 1;
  } else if (blocked.length) {
    console.log(`${blocked.length} RLS check(s) blocked pending a safe disposable-database fixture.`);
    if (process.exitCode !== 1) process.exitCode = 2;
  } else {
    console.log("All RLS checks passed and temporary records were cleaned up.");
  }
}
