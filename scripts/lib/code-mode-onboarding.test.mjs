import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../../", import.meta.url);
const endpoint = "https://playground.sketchi.app/mcp";

function read(relativePath) {
	return readFileSync(new URL(relativePath, repoRoot), "utf8");
}

/** Joins `command \\` + newline + indent, as written in a TypeScript template literal. */
function joinContinuations(source) {
	return source.replaceAll(/ \\\\\n\s+/g, " ");
}

function readJson(relativePath) {
	return JSON.parse(read(relativePath));
}

function markdownSection(markdown, heading) {
	const headingMarker = `## ${heading}`;
	const start = markdown.indexOf(headingMarker);
	assert.notEqual(start, -1, `missing section: ${headingMarker}`);
	const next = markdown.indexOf("\n## ", start + headingMarker.length);

	return markdown.slice(start, next === -1 ? undefined : next);
}

test("the playground project rename preserves the distributed MCP endpoint", () => {
	const portable = readJson(".agents/mcp_config.json");
	const codex = readJson("plugins/sketchi-code-mode-codex/.mcp.json");
	const codexSkillMetadata = read(
		"plugins/sketchi-code-mode-codex/skills/sketchi-code-mode/agents/openai.yaml",
	);
	const claude = readJson("plugins/sketchi-code-mode-claude/.mcp.json");
	const playgroundWrangler = read("apps/playground/wrangler.jsonc");

	assert.match(playgroundWrangler, /^\s*"name": "sketchi-studio",$/m);

	assert.equal(portable.mcpServers["sketchi-code-mode"].serverUrl, endpoint);
	assert.deepEqual(codex.mcpServers["sketchi-code-mode"], {
		type: "http",
		url: endpoint,
	});
	assert.deepEqual(claude.mcpServers["sketchi-code-mode"], {
		type: "http",
		url: endpoint,
	});
	assert.match(codexSkillMetadata, /^\s+transport:\s*["']streamable_http["']\s*$/m);
	assert.match(
		codexSkillMetadata,
		/^\s+url:\s*["']https:\/\/playground\.sketchi\.app\/mcp["']\s*$/m,
	);

	for (const config of [portable, codex, claude]) {
		assert.doesNotMatch(JSON.stringify(config), /sketchi-playground/);
		assert.doesNotMatch(JSON.stringify(config), /auth|token|secret|header|credential/i);
	}
	assert.doesNotMatch(codexSkillMetadata, /auth|token|secret|header|credential/i);
});

test("marketplaces and plugin manifests agree on package identity and version", () => {
	const codexMarketplace = readJson(".agents/plugins/marketplace.json");
	const codexManifest = readJson("plugins/sketchi-code-mode-codex/.codex-plugin/plugin.json");
	const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
	const claudeManifest = readJson("plugins/sketchi-code-mode-claude/.claude-plugin/plugin.json");

	const codexEntry = codexMarketplace.plugins[0];
	assert.equal(codexMarketplace.name, "sketchi-agent-plugins");
	assert.equal(codexEntry.name, codexManifest.name);
	assert.equal(codexEntry.source.path, "./plugins/sketchi-code-mode-codex");
	assert.equal(codexManifest.mcpServers, "./.mcp.json");

	const claudeEntry = claudeMarketplace.plugins[0];
	assert.equal(claudeMarketplace.name, "sketchi-agent-plugins");
	assert.equal(claudeEntry.name, claudeManifest.name);
	assert.equal(claudeEntry.source, "./plugins/sketchi-code-mode-claude");
	assert.equal(claudeEntry.version, claudeManifest.version);
	assert.equal(claudeMarketplace.version, claudeManifest.version);
	assert.equal(claudeManifest.mcpServers, "./.mcp.json");
});

test("the quickstart keeps verified install commands and public expectations", () => {
	const readme = read("README.md");
	const quickstart = read("docs/code-mode-agent-plugins.md");
	// The site splits long commands with shell line continuations; compare them joined.
	const webSetup = joinContinuations(
		read("apps/web/src/components/agent-setup-view/agent-setup-data.ts"),
	);

	assert.match(readme, /\[agent quickstart\]\(docs\/code-mode-agent-plugins\.md\)/);

	for (const command of [
		"codex plugin marketplace add shpitdev/sketchi",
		"codex plugin add sketchi-code-mode-codex@sketchi-agent-plugins",
		"codex mcp get sketchi-code-mode",
		"claude plugin marketplace add shpitdev/sketchi",
		"claude plugin install sketchi-code-mode-claude@sketchi-agent-plugins",
		"claude plugin details sketchi-code-mode-claude@sketchi-agent-plugins",
		`opencode mcp add sketchi-code-mode --url ${endpoint}`,
	]) {
		assert.ok(quickstart.includes(command), `missing onboarding command: ${command}`);
	}

	for (const command of [
		"codex plugin marketplace add shpitdev/sketchi",
		"codex plugin add sketchi-code-mode-codex@sketchi-agent-plugins",
		"claude plugin marketplace add shpitdev/sketchi",
		"claude plugin install sketchi-code-mode-claude@sketchi-agent-plugins",
		"opencode mcp add sketchi-code-mode --url ${mcpEndpoint}",
	]) {
		assert.ok(webSetup.includes(command), `stale web onboarding: ${command}`);
	}

	assert.match(
		quickstart,
		/does not require a Sketchi account, API key, OAuth login, or local\s+browser/,
	);
	assert.match(quickstart, /Do not run an MCP login command for Sketchi/);
	assert.match(quickstart, /Do not install Chrome, Playwright, or another browser/);

	const agySection = markdownSection(quickstart, "Agy (Google Antigravity)");
	const openCodeSection = markdownSection(quickstart, "OpenCode");

	// Every agent's first ask is the same short request a person would type, on
	// the site and in the quickstart alike.
	const firstAsk = webSetup.match(/FIRST_DIAGRAM_PROMPT = "([^"]+)"/)?.[1];
	assert.equal(firstAsk, "Use Sketchi to draw our release approval flow as a flowchart.");

	for (const [name, section] of [
		["Codex", markdownSection(quickstart, "Codex")],
		["Claude Code", markdownSection(quickstart, "Claude Code")],
		["Agy", agySection],
		["OpenCode", openCodeSection],
	]) {
		assert.match(section, /### Verify/, `${name} is missing verification`);
		assert.match(
			section,
			/### Create the first diagram/,
			`${name} is missing a first-diagram step`,
		);
		assert.ok(section.includes(`\n${firstAsk}\n`), `${name} is missing the first-diagram ask`);
	}

	assert.match(agySection, /test -f \.agents\/skills\/sketchi-code-mode/);
	assert.match(openCodeSection, /opencode mcp list/);
});

test("Agy and OpenCode stay on the portable skill and MCP-only boundary", () => {
	const quickstart = read("docs/code-mode-agent-plugins.md");
	const webSetup = read("apps/web/src/components/agent-setup-view/agent-setup-data.ts");
	const obsoletePlugin = new URL("plugins/sketchi-code-mode-antigravity/plugin.json", repoRoot);

	assert.equal(existsSync(obsoletePlugin), false);
	assert.match(quickstart, /\.agents\/skills\/sketchi-code-mode\/SKILL\.md/);
	assert.match(quickstart, /"serverUrl": "https:\/\/playground\.sketchi\.app\/mcp"/);
	assert.match(quickstart, /opencode\/skills\/sketchi-code-mode/);
	assert.match(quickstart, /agy plugin uninstall sketchi-code-mode-antigravity/);
	assert.match(quickstart, /Uninstalled plugin "sketchi-code-mode-antigravity"/);
	assert.match(quickstart, /Do\s+not reinstall it/i);
	assert.doesNotMatch(quickstart, /agy\s+plugin\s+(?:install|import|enable|link)\b/i);
	assert.doesNotMatch(quickstart, /eval:harness|--model|gemini-[\w.-]+/i);
	assert.doesNotMatch(webSetup, /agy\s+plugin\s+(?:install|import|enable|link)\b/i);
	assert.doesNotMatch(webSetup, /sketchi-code-mode-antigravity|--model/i);
	assert.match(webSetup, /\.agents\/skills\/sketchi-code-mode/);
	assert.match(webSetup, /Merge into \.agents\/mcp_config\.json/);

	// Setup copies the skill through the site's short URL, which must redirect
	// to the committed portable skill.
	const skillLib = read("apps/web/src/lib/portable-skill.ts");
	assert.ok(existsSync(new URL(".agents/skills/sketchi-code-mode/SKILL.md", repoRoot)));
	assert.match(
		skillLib,
		/"https:\/\/raw\.githubusercontent\.com\/shpitdev\/sketchi\/main\/\.agents\/skills\/sketchi-code-mode\/SKILL\.md"/,
	);
	assert.match(webSetup, /curl -fsSL \$\{PORTABLE_SKILL_URL\}/);
	assert.equal(quickstart.match(/curl -fsSL https:\/\/sketchi\.app\/skill\.md -o /g)?.length, 2);
	assert.doesNotMatch(quickstart, /curl[^\n]*raw\.githubusercontent\.com/);
	assert.match(webSetup, /opencode\/skills\/sketchi-code-mode/);
});

test("every distributed skill preserves the Code Mode artifact contract", () => {
	const skillPaths = [
		".agents/skills/sketchi-code-mode/SKILL.md",
		"plugins/sketchi-code-mode-codex/skills/sketchi-code-mode/SKILL.md",
		"plugins/sketchi-code-mode-claude/skills/sketchi-code-mode/SKILL.md",
	];

	for (const skillPath of skillPaths) {
		const skill = read(skillPath);
		for (const contractTerm of [
			"sketchi.buildFlowchart",
			"sketchi.buildMindmap",
			"sketchi.applyDiagramPatch",
			"artifactDelivery.finalResponseText",
			'artifactFormats: ["scene", "excalidraw", "png"]',
		]) {
			assert.ok(skill.includes(contractTerm), `${skillPath} is missing ${contractTerm}`);
		}
		assert.match(skill, /local browser/i);
		assert.match(skill, /authenticate to Sketchi/i);
	}
});
