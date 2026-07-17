import assert from "node:assert/strict";
import test from "node:test";

import { selectProductionDomainDetachments } from "./production-domain-detach.mjs";

test("domain detach selects only the project's approved Worker domains", () => {
  assert.deepEqual(
    selectProductionDomainDetachments(
      { projectId: "web", workerName: "sketchi-web" },
      [
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
      ],
    ),
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

test("domain detach fails closed on project to Worker mismatch", () => {
  assert.throws(
    () =>
      selectProductionDomainDetachments(
        { projectId: "playground", workerName: "sketchi-playground" },
        [],
      ),
    /Worker identity mismatch for project "playground"/,
  );
});

test("domain detach fails closed on live ownership drift", () => {
  assert.throws(
    () =>
      selectProductionDomainDetachments(
        { projectId: "playground", workerName: "sketchi-studio" },
        [
          {
            hostname: "playground.sketchi.app",
            id: "domain-1",
            service: "unexpected-worker",
          },
        ],
      ),
    /project playground expects Worker sketchi-studio/,
  );
});

test("internal projects never select a public domain", () => {
  assert.deepEqual(
    selectProductionDomainDetachments(
      { projectId: "excalidraw", workerName: "sketchi-excalidraw" },
      [
        {
          hostname: "excalidraw.sketchi.app",
          id: "domain-1",
          service: "sketchi-excalidraw",
        },
      ],
    ),
    [],
  );
  assert.deepEqual(
    selectProductionDomainDetachments(
      { projectId: "eval-harness", workerName: "sketchi-playground" },
      [],
    ),
    [],
  );
});
