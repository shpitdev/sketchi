# PNG Export Cleanup & Dual Exporter

## Context

### Original Request
Clean up old PNG export patterns, but KEEP Browserbase capability. Create two exporters: one for local dev (Playwright), one for Convex/serverless (Browserbase).

### Interview Summary
**Key Discussions**:
- Previous refactor created `render-png.ts` with local Playwright export
- Spike test never actually tested Browserbase - only validated export harness locally
- User needs BOTH local and remote (Browserbase) export options
- Remote exporter needed for Convex actions (serverless = no local browser)

**Research Findings**:
- Browserbase requires `playwright-core` + `@browserbasehq/sdk`
- Must use `chromium.connectOverCDP(session.connectUrl)` 
- Must use existing context: `browser.contexts()[0]` (don't create new)
- Same export harness HTML works for both local and remote

### Metis Review
**Key Points Incorporated**:
- Run baseline tests before changes
- Keep both `playwright` and `playwright-core`
- Keep `@browserbasehq/sdk`
- Delete only obsolete standalone files

---

## Work Objectives

### Core Objective
Consolidate PNG export to single source of truth (`render-png.ts`) with two modes: local (Playwright) and remote (Browserbase), wired into a Convex action.

### Concrete Deliverables
- `renderDiagramToPng()` - Local Playwright (existing, unchanged)
- `renderDiagramToPngRemote()` - NEW Browserbase-based exporter
- Convex action `exportDiagramPng` that uses the remote exporter
- 3 obsolete files deleted
- All tests passing

### Definition of Done
- [x] Both exporters produce valid PNGs (verified via `sharp` dimension check)
- [x] Browserbase exporter wired into Convex action at `packages/backend/convex/export.ts`
- [x] No duplicate export code in standalone files
- [x] All 4 optimization tests match baseline status (no regressions from this change)

### Must Have
- Two export functions in `render-png.ts`
- Convex action that calls remote exporter
- Browserbase credentials via Convex environment variables
- Same export quality from both methods

### Must NOT Have (Guardrails)
- DO NOT remove `@browserbasehq/sdk`
- DO NOT remove `playwright-core`
- DO NOT change export harness HTML (works for both)
- DO NOT modify test assertions

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **User wants tests**: Manual verification + existing test suite
- **Framework**: bun run scripts

### PNG Verification Method
Use `sharp` (already in `packages/backend/package.json`) for objective validation:
```typescript
import sharp from "sharp";
const metadata = await sharp(pngBuffer).metadata();
// Verify: metadata.width > 100, metadata.height > 100, metadata.format === "png"
```

---

## Task Flow

```
Task 1 (Baseline) → Task 2 (Delete obsolete) → Task 3 (Add remote exporter) → Task 4 (Test remote)
                                                                                     ↓
                    Task 7 (Human review) ← Task 6 (Run all tests) ← Task 5 (Convex action)
```

---

## TODOs

- [x] 1. Run Baseline Tests

  **What to do**:
  - Ensure `AI_GATEWAY_API_KEY` is set in environment
  - Run all 4 test scripts sequentially
  - Record exit codes for each

  **Must NOT do**:
  - Modify test files
  - Fix failing tests

  **Parallelizable**: NO (first task)

  **References**:
  - `packages/backend/experiments/tests/test-diagram-optimization.ts`
  - `packages/backend/experiments/tests/test-visual-grading.ts`
  - `packages/backend/experiments/tests/test-harder-diagrams.ts`
  - `packages/backend/experiments/tests/test-two-agent-pipeline.ts`

  **Acceptance Criteria**:
  - [x] Run: `bun run packages/backend/experiments/tests/test-diagram-optimization.ts`
    - Record exit code (0=pass, non-0=fail)
  - [x] Run: `bun run packages/backend/experiments/tests/test-visual-grading.ts`
    - Record exit code
  - [x] Run: `bun run packages/backend/experiments/tests/test-harder-diagrams.ts`
    - Record exit code
  - [x] Run: `bun run packages/backend/experiments/tests/test-two-agent-pipeline.ts`
    - Record exit code
  - [x] Document baseline: `{test-name: exit-code}` for all 4

  **Commit**: NO

---

- [x] 2. Delete Obsolete Standalone Files

  **What to do**:
  - Delete 3 files that have duplicate/old export patterns
  - These are standalone scripts, not imported anywhere

  **Must NOT do**:
  - Delete `share-roundtrip.ts` (different purpose)
  - Delete `lib/render-png.ts`

  **Parallelizable**: NO (depends on 1)

  **References**:
  - `packages/backend/experiments/export-diagram.ts` - DELETE (old CLI)
  - `packages/backend/experiments/generate-arch-diagram.ts` - DELETE (duplicate patterns)
  - `packages/backend/experiments/tests/spike-browserbase-export.ts` - DELETE (never tested Browserbase, misleading name)

  **Acceptance Criteria**:
  - [x] `rm packages/backend/experiments/export-diagram.ts`
  - [x] `rm packages/backend/experiments/generate-arch-diagram.ts`
  - [x] `rm packages/backend/experiments/tests/spike-browserbase-export.ts`
  - [x] Verify no broken imports (search all .ts files in packages/backend/, excluding output/):
    ```bash
    grep -r --include="*.ts" --exclude-dir="output" "export-diagram\|generate-arch-diagram\|spike-browserbase" packages/backend/
    ```
    Expected: No matches (empty output) - proves these scripts are not imported anywhere

  **Commit**: YES
  - Message: `chore(experiments): remove obsolete standalone export scripts`
  - Files: 3 deleted files

---

- [x] 3. Add Browserbase Remote Exporter

  **What to do**:
  - Add `renderDiagramToPngRemote()` function to `render-png.ts`
  - Use `@browserbasehq/sdk` to create session
  - Use `playwright-core` `connectOverCDP()` to connect
  - Handle edge case: if `context.pages()[0]` doesn't exist, create page via `context.newPage()`
  - Reuse existing `EXPORT_HARNESS_HTML` and export logic
  - Add env var handling for `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`

  **Must NOT do**:
  - Modify existing `renderDiagramToPng()` function
  - Change the export harness HTML
  - Remove any existing exports
  - Create a new context (must use `browser.contexts()[0]`)

  **Parallelizable**: NO (depends on 2)

  **References**:
  - `packages/backend/experiments/lib/render-png.ts:1-50` - Existing harness and imports
  - `packages/backend/experiments/lib/render-png.ts:264-310` - Existing `renderDiagramToPng()` pattern to follow
  - Browserbase SDK: `chromium.connectOverCDP(session.connectUrl)`

  **Implementation Pattern**:
  ```typescript
  import { chromium as chromiumCore } from "playwright-core";
  import Browserbase from "@browserbasehq/sdk";

  export async function renderDiagramToPngRemote(
    diagram: Diagram,
    options: RenderOptions = {}
  ): Promise<RenderResult> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) {
      throw new Error("Missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID");
    }

    const bb = new Browserbase({ apiKey });
    const session = await bb.sessions.create({ projectId });
    
    const browser = await chromiumCore.connectOverCDP(session.connectUrl, {
      timeout: 30000
    });
    
    // CRITICAL: Use existing context, do NOT create new context
    // Browserbase sessions always provide a default context per their documentation
    // https://docs.browserbase.com/introduction/playwright (default context usage)
    // https://docs.browserbase.com/fundamentals/using-browser-session (connectOverCDP pattern)
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      await browser.close();
      throw new Error("Browserbase session did not provide a default context. This is unexpected - check Browserbase status.");
    }
    const context = contexts[0];
    
    // Handle edge case: page may not exist yet in the context
    const page = context.pages()[0] ?? await context.newPage();

    try {
      const start = Date.now();
      const layouted = applyLayout(diagram, options.chartType ?? "flowchart");
      const elements = convertLayoutedToExcalidraw(layouted);
      
      await page.setContent(EXPORT_HARNESS_HTML);
      await page.waitForFunction("window.exportReady === true", { timeout: 30000 });
      
      const base64Png = await page.evaluate(
        async ({ elements, options }) => {
          return await (window as any).exportPng(elements, options);
        },
        { elements, options: { scale: options.scale ?? 2, padding: options.padding ?? 20, background: options.background ?? true } }
      ) as string;

      const png = Buffer.from(base64Png, "base64");
      
      return {
        png,
        durationMs: Date.now() - start,
        shareUrl: "",
      };
    } finally {
      // Only close browser, session ends automatically
      await browser.close();
    }
  }
  ```

  **Context/Page Lifecycle Rules**:
  - Check `browser.contexts()` is non-empty - throw clear error if empty
  - Use `browser.contexts()[0]` - never `browser.newContext()`
  - Use existing page if available: `context.pages()[0]`
  - If no page exists, create one: `await context.newPage()`
  - Close only the browser in finally block: `await browser.close()`
  - Session cleanup is automatic when browser closes

  **Acceptance Criteria**:
  - [x] New function `renderDiagramToPngRemote()` exported from `render-png.ts`
  - [x] Import added: `import { chromium as chromiumCore } from "playwright-core"`
  - [x] Import added: `import Browserbase from "@browserbasehq/sdk"`
  - [x] Throws if `browser.contexts()` is empty (clear error message)
  - [x] Uses `browser.contexts()[0]` (not newContext)
  - [x] Handles missing page: `context.pages()[0] ?? await context.newPage()`
  - [x] Throws clear error if env vars missing
  - [x] Lint check passes: `bun x ultracite check` → no new errors in render-png.ts

  **Commit**: YES
  - Message: `feat(export): add browserbase remote png exporter`
  - Files: `packages/backend/experiments/lib/render-png.ts`

---

- [x] 4. Test Remote Exporter Locally

  **What to do**:
  - Create a simple test script to verify Browserbase exporter works
  - Requires `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` env vars
  - Use `sharp` to verify PNG dimensions objectively

  **Must NOT do**:
  - Run without credentials (document as manual test requiring env vars)

  **Parallelizable**: NO (depends on 3)

  **References**:
  - `packages/backend/experiments/lib/render-png.ts` - Both exporters
  - `packages/backend/experiments/tests/test-visual-grading.ts:1-50` - Test pattern to follow
  - `packages/backend/package.json:21` - `sharp` dependency available

  **Acceptance Criteria**:
  - [x] Create `packages/backend/experiments/tests/test-browserbase-export.ts`
  - [x] Test creates a simple diagram with 2 shapes + 1 arrow
  - [x] Calls `renderDiagramToPngRemote()`
  - [x] Saves output to `packages/backend/experiments/output/browserbase-test.png`
    - Use same output convention: `join(import.meta.dirname, "../output/browserbase-test.png")` or hardcode full path
    - Note: Uses fixed filename (not session subfolder) because this is a one-off manual test for Browserbase connectivity, not a regression test that generates multiple outputs
  - [x] Uses `sharp` to verify dimensions:
    ```typescript
    import sharp from "sharp";
    const metadata = await sharp(result.png).metadata();
    console.log(`Dimensions: ${metadata.width}x${metadata.height}`);
    if (!metadata.width || metadata.width < 100 || !metadata.height < 100) {
      throw new Error("Invalid PNG dimensions");
    }
    ```
  - [x] Run manually: `BROWSERBASE_API_KEY=xxx BROWSERBASE_PROJECT_ID=yyy bun run packages/backend/experiments/tests/test-browserbase-export.ts`
  - [x] Exit code 0 and PNG file created

  **Commit**: YES
  - Message: `test(export): add browserbase remote export test`
  - Files: `packages/backend/experiments/tests/test-browserbase-export.ts`

---

- [x] 5. Wire Remote Exporter into Convex Action

  **What to do**:
  - Create Convex action that calls `renderDiagramToPngRemote()`
  - Action takes diagram JSON as input, returns PNG as base64 string
  - Set up Browserbase credentials as Convex environment variables

  **Must NOT do**:
  - Store PNG files on disk (Convex is serverless)
  - Use local Playwright exporter (won't work in Convex)

  **Parallelizable**: NO (depends on 4)

  **References**:
  - `packages/backend/convex/` - Convex functions directory
  - `packages/backend/experiments/lib/render-png.ts` - `renderDiagramToPngRemote` function
  - `packages/backend/experiments/lib/schemas.ts` - `Diagram` type

  **Implementation**:
  Create `packages/backend/convex/export.ts`:
  ```typescript
  "use node";
  import { action } from "./_generated/server";
  import { v } from "convex/values";
  import { renderDiagramToPngRemote } from "../experiments/lib/render-png";
  import type { Diagram } from "../experiments/lib/schemas";

  export const exportDiagramPng = action({
    args: {
      diagram: v.any(), // Diagram JSON
      options: v.optional(v.object({
        chartType: v.optional(v.string()),
        scale: v.optional(v.number()),
        padding: v.optional(v.number()),
        background: v.optional(v.boolean()),
      })),
    },
    handler: async (ctx, args) => {
      const result = await renderDiagramToPngRemote(
        args.diagram as Diagram,
        args.options ?? {}
      );
      
      // Return PNG as base64 (can't return raw Buffer from action)
      return {
        pngBase64: result.png.toString("base64"),
        durationMs: result.durationMs,
      };
    },
  });
  ```

  **Environment Variable Setup** (Convex Dashboard):
  1. Go to Convex Dashboard → Project → Settings → Environment Variables
  2. Add: `BROWSERBASE_API_KEY` = your Browserbase API key
  3. Add: `BROWSERBASE_PROJECT_ID` = your Browserbase project ID

  **Acceptance Criteria**:
  - [x] Create file: `packages/backend/convex/export.ts`
  - [x] Export `exportDiagramPng` action
  - [x] Action marked with `"use node"` directive (required for Node.js runtime)
  - [x] Run Convex dev server (from repo root): `bun run dev` (uses turborepo, starts Convex)
    - Alternative from packages/backend: `bun run dev` (runs `convex dev`)
    - Expected: No type errors, function syncs to dashboard
  - [x] Verify action appears in Convex Dashboard → Functions → `export:exportDiagramPng`
  - [x] Document env var setup: "Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in Convex Dashboard → Settings → Environment Variables"
  - [x] Test from Convex Dashboard: Run `export:exportDiagramPng` with sample diagram JSON:
    ```json
    {
      "diagram": {
        "shapes": [
          { "id": "s1", "type": "rectangle", "label": { "text": "Test" }, "width": 150, "height": 60 }
        ],
        "arrows": []
      }
    }
    ```
    - Expected: Returns `{ pngBase64: "...", durationMs: number }`
  - [x] Validate returned PNG is valid:
    - Copy `pngBase64` value from response
    - Run validation script:
      ```bash
      bun -e "
        import sharp from 'sharp';
        const b64 = 'PASTE_BASE64_HERE';
        const buf = Buffer.from(b64, 'base64');
        const m = await sharp(buf).metadata();
        console.log('Valid PNG:', m.format === 'png', 'Dimensions:', m.width, 'x', m.height);
      "
      ```
    - Expected: `Valid PNG: true Dimensions: [width] x [height]` where width/height > 100

  **Commit**: YES
  - Message: `feat(convex): add exportDiagramPng action using browserbase`
  - Files: `packages/backend/convex/export.ts`

---

- [x] 6. Run All Tests Post-Changes

  **What to do**:
  - Re-run all 4 original tests
  - Verify same pass/fail status as baseline from Task 1
  - Verify PNG outputs still valid using `sharp`

  **Must NOT do**:
  - Modify tests to make them pass
  - Change baseline expectations

  **Parallelizable**: NO (depends on 5)

  **References**:
  - Same test files as Task 1
  - Baseline results from Task 1

  **Acceptance Criteria**:
  - [x] Run: `bun run packages/backend/experiments/tests/test-diagram-optimization.ts`
    - Compare exit code to baseline
  - [x] Run: `bun run packages/backend/experiments/tests/test-visual-grading.ts`
    - Compare exit code to baseline
  - [x] Run: `bun run packages/backend/experiments/tests/test-harder-diagrams.ts`
    - Compare exit code to baseline
  - [x] Run: `bun run packages/backend/experiments/tests/test-two-agent-pipeline.ts`
    - Compare exit code to baseline
  - [x] All 4 tests match baseline status (no regressions)
  - [x] Verify a sample PNG with sharp:
    ```bash
    bun -e "import sharp from 'sharp'; const m = await sharp('packages/backend/experiments/output/[latest-dir]/[sample].png').metadata(); console.log(m.width, m.height, m.format)"
    ```
    - Expected: width > 100, height > 100, format = "png"

  **Commit**: NO

---

- [x] 7. Human Visual Review

  **What to do**:
  - Open sample PNGs from both exporters
  - Verify quality matches between local and remote (if Browserbase tested)
  - Check: no headers, not pixelated, proper padding, readable text

  **Must NOT do**:
  - Modify PNGs

  **Parallelizable**: NO (final task)

  **References**:
  - `packages/backend/experiments/output/` - All outputs
  - `packages/backend/experiments/output/browserbase-test.png` - Remote exporter output

  **Acceptance Criteria**:
  - [x] Open 3+ PNGs from latest test run
  - [x] Verify each criterion:
    - [x] No browser chrome/headers visible
    - [x] Text is crisp and readable
    - [x] White background (not transparent)
    - [x] Shapes properly rendered with borders
    - [x] Arrows connect properly
  - [x] If Browserbase test ran: compare `browserbase-test.png` quality to local outputs
  - [x] Document any visual issues found (DO NOT FIX in this plan)

  **Commit**: NO

---

## Commit Strategy

| After Task | Message | Files |
|------------|---------|-------|
| 2 | `chore(experiments): remove obsolete standalone export scripts` | 3 deleted |
| 3 | `feat(export): add browserbase remote png exporter` | render-png.ts |
| 4 | `test(export): add browserbase remote export test` | test file |
| 5 | `feat(convex): add exportDiagramPng action using browserbase` | convex/export.ts |

---

## Success Criteria

### Verification Commands
```bash
# Files deleted
ls packages/backend/experiments/export-diagram.ts 2>&1  # Error: No such file
ls packages/backend/experiments/generate-arch-diagram.ts 2>&1  # Error

# Remote exporter exists
grep "renderDiagramToPngRemote" packages/backend/experiments/lib/render-png.ts  # Found

# Convex action exists
grep "exportDiagramPng" packages/backend/convex/export.ts  # Found

# Local tests pass
bun run packages/backend/experiments/tests/test-visual-grading.ts && echo "PASS"

# PNG validation with sharp
bun -e "import sharp from 'sharp'; const m = await sharp('packages/backend/experiments/output/browserbase-test.png').metadata(); console.log(m.width, m.height, m.format)"

# Browserbase test (manual, needs credentials)
BROWSERBASE_API_KEY=xxx BROWSERBASE_PROJECT_ID=yyy \
  bun run packages/backend/experiments/tests/test-browserbase-export.ts
```

### Final Checklist
- [x] 3 obsolete files deleted
- [x] `renderDiagramToPngRemote()` function added to `render-png.ts`
- [x] `exportDiagramPng` Convex action created
- [x] Browserbase env vars documented for Convex
- [x] All 4 original tests pass (match baseline)
- [x] Browserbase test works (manual verification with credentials)
- [x] PNGs from both exporters look correct (5/6 pass all criteria, 1 has background color issue - documented)
