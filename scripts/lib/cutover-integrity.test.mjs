import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

import { productionProjectConfig } from "./deploy/production.mjs";

const repoRoot = new URL("../../", import.meta.url);
const repoPath = repoRoot.pathname;

const retiredPaths = [
  ".claude/settings.json",
  ".codex/config.toml",
  ".env.e2e.example",
  ".vercelignore",
  ".zed/settings.json",
  "biome.jsonc",
  "bun.lock",
  "goal.md",
  "goal-objective.txt",
  "opencode.jsonc",
  "packages/backend",
  "packages/config",
  "packages/env",
  "packages/opencode-excalidraw",
  "packages/shared",
  "tests/api",
  "tests/e2e",
  "turbo.json",
  ".github/workflows/cd-release.yml",
  ".github/workflows/ci-tests.yml",
  ".github/workflows/e2e-api.yml",
  ".github/workflows/e2e-web.yml",
  ".github/workflows/opencode-excalidraw-build.yml",
  ".github/workflows/opencode-excalidraw-bundle.yml",
  ".github/workflows/opencode-excalidraw-pr.yml",
  ".github/workflows/opencode-excalidraw-publish.yml",
  ".github/workflows/opencode-excalidraw-release.yml",
  ".github/workflows/v2-ci.yml",
];

const requiredReplacementPaths = [
  ".agents/mcp_config.json",
  ".agents/plugins/marketplace.json",
  ".agents/skills/sketchi-code-mode/SKILL.md",
  ".agents/skills/sketchi-log-analysis/SKILL.md",
  ".agents/skills/sketchi-log-analysis/agents/openai.yaml",
  "packages/diagram/ui/src/styles.d.ts",
];

const ignoredDirectories = new Set([
  ".git",
  ".memory",
  ".nx",
  ".output",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
]);

const textExtensions = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function repositoryTextFiles(directory = repoPath) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...repositoryTextFiles(join(directory, entry.name)));
      }
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

test("the one-shot cutover leaves no retired root or workflow artifacts", () => {
  for (const retiredPath of retiredPaths) {
    assert.equal(
      existsSync(new URL(retiredPath, repoRoot)),
      false,
      `retired legacy artifact remains: ${retiredPath}`,
    );
  }

  assert.equal(existsSync(new URL("LICENSE", repoRoot)), true);
  for (const requiredPath of requiredReplacementPaths) {
    assert.equal(
      existsSync(new URL(requiredPath, repoRoot)),
      true,
      `required replacement artifact is missing: ${requiredPath}`,
    );
  }
});

test("canonical sources contain no active lab-repository identifiers", () => {
  const staleIdentifiers = [
    ["shpitdev/sketchi", "v2"].join("-"),
    ["sketchi", "v2", "lab"].join("-"),
  ];

  for (const path of repositoryTextFiles()) {
    const content = readFileSync(path, "utf8");
    for (const identifier of staleIdentifiers) {
      assert.equal(
        content.includes(identifier),
        false,
        `stale repository identifier ${identifier} in ${relative(repoPath, path)}`,
      );
    }
  }
});

test("active sources contain no retired diagram UI identity or path", () => {
  const retiredIdentifiers = [
    ["diagram", "studio", "ui"].join("-"),
    ["@sketchi", ["diagram", "studio", "ui"].join("-")].join("/"),
    ["packages", ["diagram", "studio", "ui"].join("-")].join("/"),
  ];

  for (const path of repositoryTextFiles()) {
    const repositoryPath = relative(repoPath, path);
    if (repositoryPath.startsWith("docs/evals/")) {
      continue;
    }

    let content = readFileSync(path, "utf8");
    if (repositoryPath === "docs/repository-structure-proposal.html") {
      const historicalTreeEntry = `├── ${retiredIdentifiers[0]}/`;
      assert.equal(
        content.split(historicalTreeEntry).length - 1,
        1,
        "the proposal must preserve exactly one retired diagram UI entry in its historical Phase 2 tree",
      );
      content = content.replace(historicalTreeEntry, "");
    }

    for (const identifier of retiredIdentifiers) {
      assert.equal(
        content.includes(identifier),
        false,
        `retired diagram UI identifier ${identifier} in ${repositoryPath}`,
      );
    }
  }
});

test("the approved public-domain map is exact and internal apps stay private", () => {
  const expectedDomains = {
    excalidraw: [],
    "eval-harness": [],
    icons: ["icons.sketchi.app"],
    playground: ["playground.sketchi.app"],
    web: ["sketchi.app", "www.sketchi.app"],
  };

  for (const [projectId, domainPatterns] of Object.entries(expectedDomains)) {
    assert.deepEqual(
      productionProjectConfig(projectId).domainPatterns,
      domainPatterns,
    );
  }

  assert.equal(productionProjectConfig("excalidraw").publicSurface, false);
  assert.equal(productionProjectConfig("eval-harness").publicSurface, false);
  assert.equal(productionProjectConfig("playground").publicSurface, true);
});

test("checked-in Wrangler configs never expose production custom domains", () => {
  for (const projectId of [
    "eval-harness",
    "excalidraw",
    "icons",
    "playground",
    "web",
  ]) {
    const configPath = new URL(`apps/${projectId}/wrangler.jsonc`, repoRoot);
    const config = readFileSync(configPath, "utf8");
    assert.doesNotMatch(
      config,
      /(?:excalidraw|icons|playground|studio|www)\.sketchi\.app/,
    );
    assert.doesNotMatch(config, /"(?:route|routes|custom_domain|domains)"\s*:/);
  }
});

test("the cutover runbook preserves the audited provider boundary", () => {
  const runbook = readFileSync(
    new URL("docs/production-domain-cutover.md", repoRoot),
    "utf8",
  );
  const normalizedRunbook = runbook.replaceAll(/\s+/g, " ");
  const requiredFacts = [
    "no `sketchi.app` zone",
    "`ns1.vercel-dns.com`",
    "`ns2.vercel-dns.com`",
    "`34043a3f2790ef39.vercel-dns-016.com`",
    "`cname.vercel-dns-016.com.`",
    "Vercel `ALIAS` records cannot be recreated literally in Cloudflare",
    "`CNAME` | `@` | `34043a3f2790ef39.vercel-dns-016.com` | DNS only",
    "`CNAME` | `*` | `cname.vercel-dns-016.com.` | DNS only",
    "`pki.goog`",
    "`sectigo.com`",
    "`letsencrypt.org`",
    "there are no mail or TXT records",
    "registered and controlled through Vercel Domains",
    "WHOIS reports Name.com, Inc. as the underlying registrar",
    "nameserver changes in Vercel Domains, not at Name.com",
    "obsolete Vercel Git integration is disconnected",
    "`CLOUDFLARE_ACCOUNT_ID` variable",
    "neither has the required `CLOUDFLARE_API_TOKEN` secret",
    "transferring the registration away from Vercel",
    "CNAME flattening automatically to the apex DNS-only CNAME",
    "Workers Custom Domain cannot attach over an existing exact CNAME",
    "Never dispatch attach for `eval-harness` or `excalidraw`",
    "`studio.sketchi.app` and `excalidraw.sketchi.app` are not exposed",
  ];

  for (const fact of requiredFacts) {
    assert.ok(
      normalizedRunbook.includes(fact),
      `missing audited fact: ${fact}`,
    );
  }

  assert.doesNotMatch(runbook, /At Name\.com, replace/);
  assert.doesNotMatch(runbook, /-f project=all/);
});

test("the runbook orders the conflict-free app-specific domain cutover", () => {
  const runbook = readFileSync(
    new URL("docs/production-domain-cutover.md", repoRoot),
    "utf8",
  ).replaceAll(/\s+/g, " ");
  const orderedSteps = [
    "`status=active`",
    "-f project=icons",
    "-f project=playground",
    "delete only the staged apex DNS-only CNAME",
    "-f project=web",
    "Remove the staged wildcard DNS-only CNAME only after all four approved hosts pass verification",
  ];

  let previousIndex = -1;
  for (const step of orderedSteps) {
    const index = runbook.indexOf(step, previousIndex + 1);
    assert.ok(
      index > previousIndex,
      `cutover step is missing or out of order: ${step}`,
    );
    previousIndex = index;
  }
});

test("the Web rollback identifies and awaits its asynchronous detach before DNS restoration", () => {
  const runbook = readFileSync(
    new URL("docs/production-domain-cutover.md", repoRoot),
    "utf8",
  ).replaceAll(/\s+/g, " ");
  const workflow = readFileSync(
    new URL(".github/workflows/app-production-deploy.yml", repoRoot),
    "utf8",
  );
  const orderedSteps = [
    "Workflow dispatch is asynchronous",
    "previous_web_detach_run_id",
    "-f project=web",
    "-f domain_action=detach",
    "web_detach_run_id",
    'gh run watch "$web_detach_run_id"',
    '"https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains"',
    "Web Worker Custom Domains are absent.",
    "Only after that check passes, restore the exact apex DNS-only CNAME",
  ];

  let previousIndex = -1;
  for (const step of orderedSteps) {
    const index = runbook.indexOf(step, previousIndex + 1);
    assert.ok(
      index > previousIndex,
      `Web rollback step is missing or out of order: ${step}`,
    );
    previousIndex = index;
  }

  assert.match(
    workflow,
    /format\('production \{0\} \{1\}', inputs\.domain_action, inputs\.project\)/,
  );
  assert.match(runbook, /remaining\.length > 0/);
  assert.match(runbook, /--exit-status/);
});

test("the rollback states the limited Vercel fallback and retains Worker hosts by default", () => {
  const runbook = readFileSync(
    new URL("docs/production-domain-cutover.md", repoRoot),
    "utf8",
  ).replaceAll(/\s+/g, " ");
  const requiredFacts = [
    "ordinary application rollback keeps the Cloudflare nameservers authoritative",
    "keeps `icons.sketchi.app` and `playground.sketchi.app` attached to their Workers",
    "Vercel currently binds only `sketchi.app` and `www.sketchi.app`",
    "wildcard returns `DEPLOYMENT_NOT_FOUND` for the Icons and Playground hosts",
    "intentionally makes `icons.sketchi.app` and `playground.sketchi.app` unavailable unless a separate valid fallback is provisioned first",
    "retain the Cloudflare nameservers and their Worker Custom Domains instead",
  ];

  for (const fact of requiredFacts) {
    assert.ok(runbook.includes(fact), `missing rollback fact: ${fact}`);
  }

  assert.doesNotMatch(runbook, /all four Vercel fallback hosts/);
});
