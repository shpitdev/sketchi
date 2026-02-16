import plugin from "../dist/index.js";

const requiredTools = [
  "diagram_from_prompt",
  "diagram_tweak",
  "diagram_restructure",
  "diagram_to_png",
  "diagram_grade",
] as const;

const instance = await plugin({
  client: {} as never,
  project: {
    id: "smoke-project",
    name: "smoke-project",
    root: process.cwd(),
  } as never,
  directory: process.cwd(),
  worktree: process.cwd(),
  serverUrl: new URL("http://localhost:0"),
  $: {} as never,
});

const tools = instance.tool ?? {};
for (const toolName of requiredTools) {
  if (!(toolName in tools)) {
    throw new Error(`Smoke test failed: missing tool '${toolName}'`);
  }
}

console.log(
  `Smoke OK: loaded plugin and found tools: ${requiredTools.join(", ")}`
);
