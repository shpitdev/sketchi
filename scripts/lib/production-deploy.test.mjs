import assert from "node:assert/strict";
import test from "node:test";

import {
  productionAppConfig,
  productionDomainWranglerConfig,
} from "./production-deploy.mjs";

test("productionAppConfig returns app-scoped domain metadata", () => {
  assert.deepEqual(productionAppConfig("web"), {
    appId: "web",
    domainPatterns: ["sketchi.app", "www.sketchi.app"],
    publicSurface: true,
    routePolicy: "sketchi.app and www.sketchi.app product surface",
    title: "Sketchi Web",
    workerName: "sketchi-web",
  });
});

test("productionAppConfig includes the studio production Worker", () => {
  assert.deepEqual(productionAppConfig("studio"), {
    appId: "studio",
    domainPatterns: ["playground.sketchi.app"],
    publicSurface: true,
    routePolicy:
      "playground.sketchi.app manual attach target; studio.sketchi.app waits for authenticated Studio",
    title: "Sketchi Playground / Studio",
    workerName: "sketchi-studio",
  });
});

test("productionAppConfig keeps internal apps off public domains", () => {
  assert.deepEqual(productionAppConfig("playground"), {
    appId: "playground",
    domainPatterns: [],
    publicSurface: false,
    routePolicy: "internal eval harness; no public product domain",
    title: "Sketchi Eval Harness",
    workerName: "sketchi-playground",
  });
  assert.deepEqual(productionAppConfig("excalidraw"), {
    appId: "excalidraw",
    domainPatterns: [],
    publicSurface: false,
    routePolicy: "internal canvas workspace; no public product domain",
    title: "Sketchi Excalidraw Workspace",
    workerName: "sketchi-excalidraw",
  });
});

test("productionAppConfig rejects unknown apps", () => {
  assert.throws(
    () => productionAppConfig("docs"),
    /Unknown production app "docs"/,
  );
});

test("productionDomainWranglerConfig adds custom domains only for manual attach", () => {
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
    "icons",
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

test("productionDomainWranglerConfig attaches the manual Playground domain for studio", () => {
  const domainConfig = productionDomainWranglerConfig(
    {
      name: "sketchi-studio",
      routes: ["studio.sketchi.app/*"],
      vars: {
        SKETCHI_APP_SURFACE: "studio",
      },
    },
    "studio",
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

test("productionDomainWranglerConfig emits no public routes for internal apps", () => {
  const domainConfig = productionDomainWranglerConfig(
    {
      name: "sketchi-playground",
      routes: ["playground.sketchi.app/*"],
      vars: {
        SKETCHI_APP_SURFACE: "playground",
      },
    },
    "playground",
  );

  assert.equal(domainConfig.name, "sketchi-playground");
  assert.deepEqual(domainConfig.routes, []);
  assert.deepEqual(domainConfig.vars, {
    SKETCHI_APP_SURFACE: "playground",
  });
});
