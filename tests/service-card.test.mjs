import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the real card and booking controls with React. Fixtures are synthetic
// local test inputs; rendering does not submit forms or make API requests.
const cardUrl = new URL("../src/components/ServiceCard.tsx", import.meta.url).href;
const bookingUrl = new URL("../src/components/BookingForm.tsx", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/components/BookingForm") return { url: bookingUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if ([cardUrl, bookingUrl].includes(url)) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
let ServiceCard;
try { ({ default: ServiceCard } = await import(cardUrl)); }
finally { hooks.deregister(); }

const category = { id: "test-category", name: "Fixture category", slug: "fixture", active_status: true };
const fixture = {
  id: "test-service", title: "Fixture service", description: "A local UI test description.",
  hourly_rate: 35, duration_minutes: 120, coverage_radius_miles: 15,
  created_at: "2026-01-01T00:00:00Z", service_category_mappings: [{ category }],
};
const render = (service = fixture) => renderToStaticMarkup(createElement(ServiceCard, { service }));

test("service card presents public service details with semantic labels", () => {
  const html = render();
  const titleId = html.match(/<article[^>]*aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(titleId);
  assert.ok(html.includes(`<h3 id="${titleId}"`));
  assert.match(html, />Fixture service<\/h3>/);
  assert.ok(html.includes(fixture.description));
  assert.match(html, /<dl[^>]*>/);
  assert.match(html, /<dt[^>]*>Hourly rate<\/dt><dd[^>]*>\$35\.00 per hour \(USD\)<\/dd>/);
  assert.match(html, /<dt[^>]*>Duration<\/dt><dd>120 minutes<\/dd>/);
  assert.match(html, /<dt[^>]*>Coverage radius<\/dt><dd>15 miles<\/dd>/);
  assert.match(html, /aria-label="Categories for Fixture service"/);
  assert.ok(html.includes(category.name));
});

test("service card supports free services, missing descriptions and absent categories", () => {
  const html = render({ ...fixture, description: null, hourly_rate: 0, coverage_radius_miles: 1,
    service_category_mappings: [{ category: null }, { category: { ...category, name: "Inactive category", active_status: false } }] });
  assert.match(html, /\$0\.00 per hour \(USD\)/);
  assert.match(html, /No description provided/);
  assert.match(html, /<dd>1 mile<\/dd>/);
  assert.doesNotMatch(html, /Inactive category|Categories for/);
});

test("cards have distinct heading associations even with repeated service titles", () => {
  const html = renderToStaticMarkup(createElement("div", null,
    createElement(ServiceCard, { service: fixture }),
    createElement(ServiceCard, { service: { ...fixture, id: "second-test-service" } })));
  const ids = [...html.matchAll(/<article[^>]*aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.ok(html.includes(`<h3 id="${id}"`));
});

test("booking controls identify their service and use native labeled controls", () => {
  const html = render();
  assert.match(html, /<details[^>]*><summary[^>]*>Request Fixture service<\/summary>/);
  assert.match(html, /<form aria-label="Booking request for Fixture service"/);
  assert.match(html, /<label[^>]*>Email<input[^>]*type="email"/);
  assert.match(html, /<label[^>]*>Requested date<input[^>]*type="date"/);
  assert.match(html, /<label[^>]*>Notes for Fixture service[^<]*<textarea[^>]*required=""/);
  assert.match(html, /aria-label="Send booking request for Fixture service"/);
});

test("service card escapes content and does not display extra private provider properties", () => {
  const html = render({ ...fixture, title: "<img src=x onerror=alert(1)>",
    description: "<script>alert(1)</script>", provider_id: "private-provider-id",
    provider_email: "private-contact@example.invalid" });
  assert.doesNotMatch(html, /<img|<script|private-provider-id|private-contact/);
  assert.ok(html.includes("&lt;script&gt;"));
});
