import assert from "node:assert/strict";
import test from "node:test";

import {
  productionDomainWranglerConfig,
  productionProjectConfig,
} from "./production.mjs";
import { workerProjectConfig } from "../worker-apps.mjs";

test("productionProjectConfig returns project-scoped domain metadata", () => {
  assert.deepEqual(productionProjectConfig("web"), {
    ...workerProjectConfig("web"),
    domainPatterns: ["sketchi.app", "www.sketchi.app"],
    publicSurface: true,
    routePolicy: "sketchi.app and www.sketchi.app product surface",
    title: "Sketchi Web",
  });
});

test("playground project preserves the Studio production Worker", () => {
  assert.deepEqual(productionProjectConfig("playground"), {
    ...workerProjectConfig("playground"),
    domainPatterns: ["playground.sketchi.app"],
    publicSurface: true,
    routePolicy:
      "playground.sketchi.app product surface; authenticated Studio remains unexposed",
    title: "Sketchi Playground / Studio",
  });
});

test("internal projects stay off public domains", () => {
  assert.deepEqual(productionProjectConfig("eval-harness"), {
    ...workerProjectConfig("eval-harness"),
    domainPatterns: [],
    publicSurface: false,
    routePolicy: "internal eval harness; no public product domain",
    title: "Sketchi Eval Harness",
  });
  assert.deepEqual(productionProjectConfig("excalidraw"), {
    ...workerProjectConfig("excalidraw"),
    domainPatterns: [],
    publicSurface: false,
    routePolicy: "internal canvas workspace; no public product domain",
    title: "Sketchi Excalidraw Workspace",
  });
});

test("production project selection is explicit and closed", () => {
  assert.throws(
    () => productionProjectConfig(),
    /Production project selection is required/,
  );
  assert.throws(
    () => productionProjectConfig("studio"),
    /Unknown production project "studio"/,
  );
});

test("productionDomainWranglerConfig adds only approved manual domains", () => {
  const domainConfig = productionDomainWranglerConfig(
    {
      name: "sketchi-icons",
      route: "icons.sketchi.app/*",
      routes: ["icons.sketchi.app/*"],
      domains: [{ pattern: "icons.sketchi.app" }],
      custom_domain: true,
      vars: {
        SKETCHI_APP_SURFACE: "icons",
      },
      r2_buckets: [
        {
          binding: "SKETCHI_ARTIFACTS",
          bucket_name: "sketchi-studio-codemode-artifacts-production",
          preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
        },
      ],
    },
    { projectId: "icons", workerName: "sketchi-icons" },
  );

  assert.equal(domainConfig.name, "sketchi-icons");
  assert.equal(domainConfig.topLevelName, "sketchi-icons");
  assert.equal(domainConfig.workers_dev, true);
  assert.deepEqual(domainConfig.routes, [
    {
      pattern: "icons.sketchi.app",
      custom_domain: true,
    },
  ]);
  assert.equal(domainConfig.route, undefined);
  assert.equal(domainConfig.domains, undefined);
  assert.equal(domainConfig.custom_domain, undefined);
  assert.deepEqual(domainConfig.vars, {
    SKETCHI_APP_SURFACE: "icons",
  });
  assert.deepEqual(domainConfig.r2_buckets, [
    {
      binding: "SKETCHI_ARTIFACTS",
      bucket_name: "sketchi-studio-codemode-artifacts-production",
      preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
    },
  ]);
});

test("playground domain attach preserves Studio runtime identity and contracts", () => {
  const domainConfig = productionDomainWranglerConfig(
    {
      name: "sketchi-studio",
      routes: ["playground.sketchi.app/*"],
      vars: {
        SKETCHI_APP_SURFACE: "studio",
      },
    },
    { projectId: "playground", workerName: "sketchi-studio" },
  );

  assert.equal(domainConfig.name, "sketchi-studio");
  assert.deepEqual(domainConfig.routes, [
    {
      pattern: "playground.sketchi.app",
      custom_domain: true,
    },
  ]);
  assert.deepEqual(domainConfig.vars, {
    SKETCHI_APP_SURFACE: "studio",
  });
});

test("domain attach fails closed on project or source Worker mismatch", () => {
  assert.throws(
    () =>
      productionDomainWranglerConfig(
        { name: "sketchi-studio" },
        { projectId: "playground", workerName: "sketchi-playground" },
      ),
    /Worker identity mismatch for project "playground"/,
  );
  assert.throws(
    () =>
      productionDomainWranglerConfig(
        { name: "sketchi-playground" },
        { projectId: "playground", workerName: "sketchi-studio" },
      ),
    /Wrangler name mismatch for project "playground"/,
  );
});

test("internal projects emit no public routes", () => {
  const domainConfig = productionDomainWranglerConfig(
    {
      name: "sketchi-playground",
      routes: ["playground.sketchi.app/*"],
      vars: {
        SKETCHI_APP_SURFACE: "playground",
      },
    },
    { projectId: "eval-harness", workerName: "sketchi-playground" },
  );

  assert.equal(domainConfig.name, "sketchi-playground");
  assert.deepEqual(domainConfig.routes, []);
  assert.deepEqual(domainConfig.vars, {
    SKETCHI_APP_SURFACE: "playground",
  });
});
