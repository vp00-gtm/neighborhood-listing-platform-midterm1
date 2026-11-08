import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import ts from "typescript";

// Exercise the real component/effect with deterministic hooks, fetch and time.
// All response values below are unit-test fixtures, never database results.
const componentUrl = new URL("../src/components/ServicesExplorer.tsx", import.meta.url).href;
const hooksUrl = "neighborhood-test:explorer-hooks";
const cardUrl = "neighborhood-test:service-card";
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === componentUrl && specifier === "react") {
      return { url: hooksUrl, shortCircuit: true };
    }
    if (specifier === "@/components/ServiceCard") {
      return { url: cardUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === componentUrl) {
      return {
        format: "module", shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    }
    if (url === hooksUrl) {
      return {
        format: "module", shortCircuit: true,
        source: `
          let values, cursor, effect, previousDeps, cleanup;
          export function reset() { values = []; previousDeps = undefined; cleanup = undefined; }
          export function useState(initial) {
            const index = cursor++;
            if (!(index in values)) values[index] = initial;
            return [values[index], value => {
              values[index] = typeof value === 'function' ? value(values[index]) : value;
            }];
          }
          export function useEffect(setup, deps) {
            if (!previousDeps || deps.some((value, index) => value !== previousDeps[index])) {
              effect = setup;
              previousDeps = deps;
            }
          }
          export function render(Component) {
            cursor = 0; effect = undefined;
            const tree = Component();
            if (effect) { cleanup?.(); cleanup = effect(); }
            return tree;
          }
          export function unmount() { cleanup?.(); }
          export function replayEffect() { cleanup?.(); cleanup = effect(); }
        `,
      };
    }
    if (url === cardUrl) {
      return { format: "module", shortCircuit: true, source: "export default function Card() { return null; }" };
    }
    return nextLoad(url, context);
  },
});
let ServicesExplorer;
let harness;
try {
  ({ default: ServicesExplorer } = await import(componentUrl));
  harness = await import(hooksUrl);
} finally {
  hooks.deregister();
}

function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return text(node.props?.children);
}
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function render() { return harness.render(ServicesExplorer); }
function setup(t, fetchImpl) {
  harness.reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", fetchImpl);
  t.after(() => harness.unmount());
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("services loading ends with the empty state after a successful empty response", async (t) => {
  setup(t, async () => Response.json({ services: [] }));
  assert.match(text(render()), /Loading approved services/);
  await setImmediate();
  assert.match(text(render()), /No approved services/);
  t.mock.timers.tick(15_000);
  assert.doesNotMatch(text(render()), /taking too long/);
});

test("services loader accepts the documented nested category response shape", async (t) => {
  const fixture = {
    id: "unit-test-service", title: "Unit-test fixture only", description: null,
    hourly_rate: 25, duration_minutes: 30, coverage_radius_miles: 2,
    created_at: "2026-01-01T00:00:00Z",
    service_category_mappings: [
      { category: { id: "unit-test-category", name: "Fixture category", slug: "fixture", active_status: true } },
      { category: null },
    ],
  };
  setup(t, async () => Response.json({ services: [fixture] }));
  render();
  await setImmediate();
  const tree = render();
  assert.doesNotMatch(text(tree), /Loading approved services|could not|expected format/);
  assert.deepEqual(find(tree, (node) => Boolean(node.props?.service))?.props.service, fixture);
});

test("services loader shows an error for unsuccessful HTTP responses", async (t) => {
  setup(t, async () => Response.json({ error: "Unavailable" }, { status: 503 }));
  render(); await setImmediate();
  assert.match(text(render()), /Services could not be loaded/);
  assert.equal(text(find(render(), (node) => node.type === "button")), "Try again");
  assert.doesNotMatch(text(render()), /Loading approved services/);
});

test("services loader handles network errors with a helpful message", async (t) => {
  setup(t, async () => { throw new TypeError("Failed to fetch"); });
  render(); await setImmediate();
  assert.match(text(render()), /Services could not be loaded/);
  assert.equal(text(find(render(), (node) => node.type === "button")), "Try again");
  assert.doesNotMatch(text(render()), /Loading approved services/);
});

test("services loader rejects malformed JSON and mismatched response shapes", async (t) => {
  setup(t, async () => new Response("not JSON"));
  render(); await setImmediate();
  assert.doesNotMatch(text(render()), /Loading approved services/);
  assert.ok(find(render(), (node) => node.props?.role === "alert"));
  for (const payload of [{ services: null }, { services: [{}] }, { data: [] }]) {
    harness.unmount(); harness.reset();
    globalThis.fetch = async () => Response.json(payload);
    render(); await setImmediate();
    assert.match(text(render()), /expected format/);
  }
});

test("pending fetch times out, clears loading and aborts the request", async (t) => {
  let signal;
  setup(t, (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  render();
  t.mock.timers.tick(15_000);
  await setImmediate();
  assert.equal(signal.aborted, true);
  assert.match(text(render()), /taking too long/);
  assert.equal(text(find(render(), (node) => node.type === "button")), "Try again");
  assert.doesNotMatch(text(render()), /Loading approved services/);
});

test("pending JSON body also times out and late data cannot overwrite the error", async (t) => {
  const body = deferred();
  setup(t, async () => ({ ok: true, json: () => body.promise }));
  render(); await setImmediate();
  t.mock.timers.tick(15_000);
  await setImmediate();
  assert.match(text(render()), /taking too long/);
  body.resolve({ services: [] });
  await setImmediate();
  assert.match(text(render()), /taking too long/);
  assert.doesNotMatch(text(render()), /No approved services/);
});

test("retry recovers after timeout and ignores an old response", async (t) => {
  const first = deferred();
  let calls = 0;
  setup(t, () => ++calls === 1 ? first.promise : Promise.resolve(Response.json({ services: [] })));
  render(); t.mock.timers.tick(15_000); await setImmediate();
  const button = find(render(), (node) => node.type === "button");
  assert.ok(button, "Timed-out request must expose retry");
  button.props.onClick(); render(); await setImmediate();
  assert.match(text(render()), /No approved services/);
  first.resolve(Response.json({ services: null }));
  await setImmediate();
  assert.match(text(render()), /No approved services/);
});

test("Strict Mode cleanup/replay cancels old requests without hiding the active result", async (t) => {
  const first = deferred();
  const signals = [];
  setup(t, (_url, { signal }) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : Promise.resolve(Response.json({ services: [] }));
  });
  render(); harness.replayEffect(); await setImmediate();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.match(text(render()), /No approved services/);
  first.resolve(Response.json({ services: null })); await setImmediate();
  assert.match(text(render()), /No approved services/);
});

test("services announce loading/results and keep a focusable refresh control", async (t) => {
  const response = deferred();
  let calls = 0;
  setup(t, (url, options) => {
    assert.equal(url, "/api/services");
    assert.ok(options.signal instanceof AbortSignal);
    calls++;
    return response.promise;
  });
  const loading = render();
  const button = find(loading, (node) => node.type === "button");
  assert.equal(button.props.type, "button");
  assert.equal(button.props.disabled, undefined, "Control stays in keyboard tab order");
  assert.equal(button.props["aria-disabled"], true);
  assert.equal(button.props["aria-controls"], "services-results");
  assert.equal(find(loading, (node) => node.props?.id === "services-results").props["aria-busy"], true);
  assert.equal(find(loading, (node) => node.props?.role === "status").props["aria-live"], "polite");
  button.props.onClick();
  assert.equal(calls, 1, "Busy control must not start duplicate requests");
  response.resolve(Response.json({ services: [] })); await setImmediate();
  const loaded = render();
  assert.equal(find(loaded, (node) => node.props?.id === "services-results").props["aria-busy"], false);
  assert.equal(text(find(loaded, (node) => node.type === "button")), "Refresh services");
  assert.match(text(find(loaded, (node) => node.props?.role === "status")), /No approved services/);
});

test("successful retry announces the count and renders the named services list", async (t) => {
  let calls = 0;
  const fixture = {
    id: "test-service", title: "UI test fixture", description: null, hourly_rate: 0,
    duration_minutes: 15, coverage_radius_miles: 1, created_at: "2026-01-01T00:00:00Z",
    service_category_mappings: [],
  };
  setup(t, async () => ++calls === 1
    ? new Response(null, { status: 500 }) : Response.json({ services: [fixture] }));
  render(); await setImmediate();
  const retry = find(render(), (node) => node.type === "button");
  assert.equal(text(retry), "Try again");
  retry.props.onClick(); render(); await setImmediate();
  const result = render();
  assert.match(text(find(result, (node) => node.props?.role === "status")), /1 approved service available/);
  assert.equal(find(result, (node) => node.type === "ul").props["aria-label"], "Approved neighborhood services");
  assert.equal(find(result, (node) => node.props?.role === "alert"), undefined);
});

test("services reject invalid numeric display values instead of rendering broken cards", async (t) => {
  const fixture = {
    id: "test-service", title: "UI test fixture", description: null, hourly_rate: 10,
    duration_minutes: 15, coverage_radius_miles: 1, created_at: "2026-01-01T00:00:00Z",
    service_category_mappings: [],
  };
  setup(t, async () => Response.json({ services: [] }));
  for (const patch of [{ hourly_rate: -1 }, { duration_minutes: 0 }, { duration_minutes: 15.5 }, { coverage_radius_miles: 0 }]) {
    harness.unmount(); harness.reset();
    globalThis.fetch = async () => Response.json({ services: [{ ...fixture, ...patch }] });
    render(); await setImmediate();
    assert.match(text(render()), /expected format/);
    assert.equal(find(render(), (node) => Boolean(node.props?.service)), undefined);
  }
});
