import assert from "node:assert/strict";
import test from "node:test";

import { selectProductionDomainDetachments } from "./production-domain-detach.mjs";

test("selectProductionDomainDetachments returns only the app's approved domains", () => {
  assert.deepEqual(
    selectProductionDomainDetachments("web", [
      { hostname: "sketchi.app", id: "domain-1", service: "sketchi-web" },
      {
        hostname: "www.sketchi.app",
        id: "domain-2",
        service: "sketchi-web",
      },
      {
        hostname: "icons.sketchi.app",
        id: "domain-3",
        service: "sketchi-icons",
      },
    ]),
    [
      { hostname: "sketchi.app", id: "domain-1", service: "sketchi-web" },
      {
        hostname: "www.sketchi.app",
        id: "domain-2",
        service: "sketchi-web",
      },
    ],
  );
});

test("selectProductionDomainDetachments fails closed on ownership drift", () => {
  assert.throws(
    () =>
      selectProductionDomainDetachments("studio", [
        {
          hostname: "playground.sketchi.app",
          id: "domain-1",
          service: "unexpected-worker",
        },
      ]),
    /Refusing to detach playground\.sketchi\.app/,
  );
});

test("internal apps never select a public domain", () => {
  assert.deepEqual(
    selectProductionDomainDetachments("excalidraw", [
      {
        hostname: "excalidraw.sketchi.app",
        id: "domain-1",
        service: "sketchi-excalidraw",
      },
    ]),
    [],
  );
  assert.deepEqual(selectProductionDomainDetachments("playground", []), []);
});
