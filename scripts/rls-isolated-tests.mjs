import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

// No environment file, project URL, password or production account is used.
// Docker has no network and no host mounts/ports; psql uses its Unix socket.
const image = "public.ecr.aws/supabase/postgres:17.11.0.018";
const container = `cis3610-rls-${randomUUID().slice(0, 8)}`;
const results = [];
let started = false;
function docker(args, input) {
  return spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 90_000 });
}
function execute(sql, allowError = false) {
  const result = docker(["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=verbose", "-h", "/tmp", "-U", "postgres", "-d", "postgres"], sql);
  if (result.status !== 0 && !allowError) throw Error((result.stderr || result.error?.message || "Isolated SQL failed").trim());
  return { status: result.status, output: result.stdout?.trim() ?? "", error: result.stderr ?? "" };
}
const users = {
  admin: "1fbdbbfb-33d8-4dbe-af0c-55b5b57e97c0", providerA: "46e4e555-f621-4c9d-bbff-fb07de4cc2e0",
  providerB: "a9658e7b-ec7a-4984-bbfb-fe973ebe0476", clientA: "efaf1676-705e-412d-9280-7183714e1817",
};
const service = (n) => `b1000000-0000-4000-8000-00000000000${n}`;
function asRole(label, sql, allowError = false) {
  const role = label === "anon" ? "anon" : label === "elevated" ? "service_role" : "authenticated";
  const id = users[label] ?? (label === "elevated" ? users.admin : "");
  return execute(`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL "request.jwt.claim.sub" = '${id}'; ${sql}; ROLLBACK;`, allowError);
}
function check(name, run) {
  try { run(); results.push({ name, status: "PASS" }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: "FAIL", detail: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function expect(label, sql, value) { assert.equal(asRole(label, sql).output, value); }
function denied(label, sql) {
  const result = asRole(label, sql, true);
  assert.ok(result.status === 0 ? result.output === "" : /42501/.test(result.error), "Expected RLS/permission denial, not a different SQL error");
}
function unchangedSnapshot() {
  return execute(`SELECT json_build_object(
    'profiles',(SELECT json_agg(x ORDER BY id) FROM (SELECT id,display_name,created_at,updated_at FROM profiles) x),
    'services',(SELECT json_agg(x ORDER BY id) FROM (SELECT id,provider_id,name,description,price_amount,currency,status,created_at,updated_at FROM services) x),
    'categories',(SELECT json_agg(x ORDER BY id) FROM (SELECT id,name,slug,description,is_active,created_at,updated_at FROM service_categories) x),
    'mappings',(SELECT json_agg(x ORDER BY service_id,category_id) FROM service_category_mappings x),
    'bookings',(SELECT json_agg(x ORDER BY id) FROM (SELECT id,client_id,service_id,scheduled_at,client_notes,created_at,updated_at FROM bookings) x)
  )::text;`).output;
}

try {
  const command = "initdb -D /tmp/exam-pg -A trust --no-locale --encoding=UTF8 >/tmp/exam-init.log && exec postgres -D /tmp/exam-pg -k /tmp -c listen_addresses= -c timezone=UTC";
  const launched = docker(["run", "--detach", "--name", container, "--user", "postgres", "--network", "none", "--tmpfs", "/tmp:rw,mode=1777", "--entrypoint", "/bin/sh", image, "-c", command]);
  if (launched.status !== 0) throw Error(launched.stderr || "Cannot launch isolated PostgreSQL");
  started = true;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (docker(["exec", container, "pg_isready", "-h", "/tmp", "-U", "postgres"]).status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (attempt === 29) throw Error("Isolated PostgreSQL did not become ready");
  }
  execute(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;`);
  execute(readFileSync("supabase/migrations-archive/20261029140000_exam_services_persistence.sql", "utf8"));
  execute(readFileSync("tests/fixtures/exam-legacy-seed.sql", "utf8"));
  const original = unchangedSnapshot();
  for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    execute(readFileSync(`supabase/migrations/${file}`, "utf8"));
    results.push({ name: `Migration executes: ${file}`, status: "PASS" });
    console.log(`PASS migration ${file}`);
  }
  check("Legacy IDs, prices, currencies, notes, references and timestamps preserved", () => assert.equal(unchangedSnapshot(), original));
  check("Public approved services readable", () => expect("anon", "SELECT count(*) FROM services", "2"));
  check("Public draft services hidden", () => expect("anon", "SELECT count(*) FROM services WHERE status='draft'", "0"));
  check("Public inactive category control hidden", () => expect("anon", "SELECT count(*) FROM service_categories WHERE id='a1000000-0000-4000-8000-000000000002'", "0"));
  check("Public active category readable", () => expect("anon", "SELECT count(*) FROM service_categories", "1"));
  check("Public mappings restricted to approved services", () => expect("anon", "SELECT count(*) FROM service_category_mappings", "2"));
  check("Provider A sees only owned services", () => expect("providerA", "SELECT count(*) FROM services", "2"));
  check("Provider A reads own approved mappings", () => expect("providerA", `SELECT count(*) FROM service_category_mappings WHERE service_id='${service(1)}'`, "1"));
  check("Provider creates owned draft using allowed insert columns", () => expect("providerA", `INSERT INTO services(provider_id,title,hourly_rate,duration_minutes,coverage_radius_miles) VALUES('${users.providerA}','Isolated new draft',0,15,1) RETURNING provider_id::text || ':' || status`, `${users.providerA}:draft`));
  check("Provider cannot forge another owner", () => denied("providerA", `INSERT INTO services(provider_id,title,hourly_rate,duration_minutes,coverage_radius_miles) VALUES('${users.providerB}','Forged owner test',0,15,1) RETURNING id`));
  check("Provider updates own draft", () => expect("providerA", `UPDATE services SET title='Allowed isolated edit' WHERE id='${service(2)}' RETURNING title`, "Allowed isolated edit"));
  check("Provider edits own suspended service", () => expect("providerB", `UPDATE services SET title='Suspended isolated edit' WHERE id='${service(4)}' RETURNING title`, "Suspended isolated edit"));
  check("Cross-provider update denied", () => denied("providerA", `UPDATE services SET title='Forbidden isolated edit' WHERE id='${service(4)}' RETURNING id`));
  check("Cross-provider delete denied", () => denied("providerA", `DELETE FROM services WHERE id='${service(4)}' RETURNING id`));
  check("Provider approved-service edit denied", () => denied("providerA", `UPDATE services SET title='Forbidden approved edit' WHERE id='${service(1)}' RETURNING id`));
  check("Provider approved-service deletion denied", () => denied("providerA", `DELETE FROM services WHERE id='${service(1)}' RETURNING id`));
  check("Provider can delete owned eligible service", () => expect("providerA", `DELETE FROM services WHERE id='${service(2)}' RETURNING id`, service(2)));
  check("Provider submits own draft to pending", () => expect("providerA", `UPDATE services SET status='pending' WHERE id='${service(2)}' RETURNING status`, "pending"));
  check("Provider cannot approve own service", () => denied("providerA", `UPDATE services SET status='pending' WHERE id='${service(2)}'; UPDATE services SET status='approved' WHERE id='${service(2)}' RETURNING id`));
  check("Client cannot approve a service", () => denied("clientA", `UPDATE services SET status='approved' WHERE id='${service(2)}' RETURNING id`));
  check("Admin approves pending service", () => expect("providerA", `UPDATE services SET status='pending' WHERE id='${service(2)}'; SET LOCAL "request.jwt.claim.sub"='${users.admin}'; UPDATE services SET status='approved' WHERE id='${service(2)}' RETURNING status`, "approved"));
  check("Admin suspends approved service", () => expect("admin", `UPDATE services SET status='suspended' WHERE id='${service(1)}' RETURNING status`, "suspended"));
  check("Client cannot self-assign admin role", () => denied("clientA", `UPDATE profiles SET role='admin' WHERE id='${users.clientA}' RETURNING id`));
  for (const label of ["anon", "clientA"]) {
    check(`${label} inserts a valid booking without SELECT rights`, () => expect(label, `INSERT INTO bookings(service_id,client_email,requested_date,notes) VALUES('${service(1)}','fixture@example.test','2026-12-03','Isolated booking test'); SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${users.admin}'; SELECT count(*) FROM bookings WHERE client_email='fixture@example.test' AND notes='Isolated booking test'`, "1"));
  }
  check("Booking for non-approved service denied", () => denied("clientA", `INSERT INTO bookings(service_id,client_email,requested_date,notes) VALUES('${service(2)}','fixture@example.test','2026-12-03','Invalid target booking')`));
  check("Anonymous booking reads denied", () => denied("anon", "SELECT id FROM bookings"));
  check("Client booking reads hidden", () => expect("clientA", "SELECT count(*) FROM bookings", "0"));
  check("Provider sees only associated bookings", () => expect("providerA", "SELECT count(*) FROM bookings", "1"));
  check("Admin reads all fixture bookings", () => expect("admin", "SELECT count(*) FROM bookings", "2"));
  check("Provider deletion restricted while services reference it", () => assert.match(execute(`BEGIN; DELETE FROM profiles WHERE id='${users.providerA}'; ROLLBACK;`, true).error, /23503/));
  check("Category deletion cascades mappings but preserves services/bookings", () => assert.equal(execute("BEGIN; DELETE FROM service_categories WHERE id='a1000000-0000-4000-8000-000000000001'; SELECT (SELECT count(*) FROM service_category_mappings WHERE category_id='a1000000-0000-4000-8000-000000000001') || ':' || (SELECT count(*) FROM services) || ':' || (SELECT count(*) FROM bookings); ROLLBACK;").output, "0:4:2"));
  check("Service deletion cascades bookings and mappings", () => assert.equal(execute(`BEGIN; DELETE FROM services WHERE id='${service(1)}'; SELECT (SELECT count(*) FROM bookings WHERE service_id='${service(1)}') || ':' || (SELECT count(*) FROM service_category_mappings WHERE service_id='${service(1)}'); ROLLBACK;`).output, "0:0"));
  check("Admin elevated read/write across five application tables", () => {
    const result = execute(`BEGIN; INSERT INTO auth.users(id,email) VALUES('e1000000-0000-4000-8000-000000000001','new@example.test'); SET LOCAL ROLE service_role; SET LOCAL "request.jwt.claim.sub"='${users.admin}';
      INSERT INTO profiles(id,role,display_name) VALUES('e1000000-0000-4000-8000-000000000001','client','Isolated profile');
      INSERT INTO services(id,provider_id,title,hourly_rate,duration_minutes,coverage_radius_miles) VALUES('e1000000-0000-4000-8000-000000000002','${users.providerA}','Elevated test service',10,15,1);
      INSERT INTO service_categories(id,name,slug) VALUES('e1000000-0000-4000-8000-000000000003','Elevated test category','Elevated-Test');
      INSERT INTO service_category_mappings(service_id,category_id) VALUES('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003');
      INSERT INTO bookings(id,service_id,client_email,requested_date,notes) VALUES('e1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000002','test@example.test','2026-12-03','Elevated fixture booking');
      SELECT (SELECT count(*) FROM profiles WHERE id='e1000000-0000-4000-8000-000000000001') || ':' || (SELECT count(*) FROM services WHERE id='e1000000-0000-4000-8000-000000000002') || ':' || (SELECT count(*) FROM service_categories WHERE id='e1000000-0000-4000-8000-000000000003') || ':' || (SELECT count(*) FROM service_category_mappings WHERE service_id='e1000000-0000-4000-8000-000000000002') || ':' || (SELECT count(*) FROM bookings WHERE id='e1000000-0000-4000-8000-000000000004'); ROLLBACK;`);
    assert.equal(result.output, "1:1:1:1:1");
  });
  check("Every rolled-back test leaves legacy fixtures unchanged", () => assert.equal(unchangedSnapshot(), original));
} catch (error) {
  if (started) {
    const logs = docker(["logs", container]);
    console.error((logs.stderr || logs.stdout || "No isolated container logs available").trim());
  }
  results.push({ name: "Isolated database setup/migration execution", status: "FAIL", detail: error.message });
  console.error(error.message);
} finally {
  if (started) {
    const removed = docker(["rm", "--force", container]);
    results.push({ name: "Disposable container removed", status: removed.status === 0 ? "PASS" : "FAIL" });
  }
}
console.log(`RLS_ISOLATED_RESULT=${JSON.stringify({ mode: "isolated PostgreSQL", productionTouched: false, results })}`);
process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
