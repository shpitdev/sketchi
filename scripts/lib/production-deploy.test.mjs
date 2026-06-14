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
    title: "Sketchi Web",
    workerName: "sketchi-web",
  });
});

test("productionAppConfig includes the studio production Worker", () => {
  assert.deepEqual(productionAppConfig("studio"), {
    appId: "studio",
    domainPatterns: ["studio.sketchi.app"],
    title: "Sketchi Studio",
    workerName: "sketchi-studio",
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
