# PNG Export Improvement

## Context

### Original Request
Replace current PNG export (excalidraw.com + keyboard shortcuts + canvas screenshot) with a cleaner approach that properly frames/zooms exports at higher resolution without UI artifacts.

### Interview Summary
**Key Discussions**:
- Use Excalidraw's libraries for rendering fidelity (no custom SVG generation)
- User proposed Browserbase for browser runtime
- Must work from Convex actions
- Single approach preferred, no fallbacks

**Research Findings**:
- **Browserbase**: Hosted headless browser, credentials already configured
- **playwright-core**: Works in Convex with `externalPackages` config (~8MB, no native deps)
- **page.setContent()**: Can inject HTML directly - no need to host export harness
- **@excalidraw/utils**: Official `exportToBlob` API for PNG export

### Oracle Strategic Guidance
Keep browser in the loop for fidelity, but stop automating UI. Create export harness that calls Excalidraw's API directly.

**Key insight**: Browserbase + page.setContent() = inject export harness inline, call exportToBlob, get PNG bytes.

---

## Work Objectives

### Core Objective
Replace excalidraw.com screenshot approach with Browserbase-powered export that calls Excalidraw's official `exportToBlob` API directly.

### Concrete Deliverables
- Spike experiment validating Browserbase + Excalidraw export
- Updated `render-png.ts` using Browserbase instead of local Playwright + excalidraw.com
- Convex action for PNG export (optional, future)

### Definition of Done
- [x] Export works via Browserbase (no local browser)
- [x] Uses Excalidraw's official `exportToBlob` API
- [x] Resolution configurable via `scale` option (1x, 2x, 3x)
- [x] Padding configurable via `padding` option
- [x] No UI artifacts in output
- [x] Performance: <10s per export (network to Browserbase)
- [x] Works from Node.js (Convex-compatible)

### Must Have
- 100% rendering fidelity with Excalidraw
- Configurable: scale, padding, background
- No excalidraw.com dependency
- Clean, properly framed output

### Must NOT Have (Guardrails)
- Custom SVG generation
- UI automation (keyboard shortcuts, clicks)
- Local browser installation requirement
- Changes to `Diagram` input type

---

## Architecture

```
Node.js / Convex Action
    │
    ├── @browserbasehq/sdk
    │   └── bb.sessions.create({ projectId })
    │       → Returns session.connectUrl
    │
    ├── playwright-core
    │   └── chromium.connectOverCDP(connectUrl)
    │       → Remote browser connection
    │
    ├── page.setContent(exportHarnessHTML)
    │   └── Inline HTML with:
    │       - import { exportToBlob } from "@excalidraw/excalidraw"
    │       - window.exportPng = async (elements, opts) => { ... }
    │
    ├── page.evaluate(() => window.exportPng(elements, options))
    │   └── Returns base64 PNG string
    │
    └── Buffer.from(base64, "base64")
        → PNG bytes ready for storage/return
```

### Export Harness (Inline HTML)
```html
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  { "imports": { "@excalidraw/excalidraw": "https://esm.sh/@excalidraw/excalidraw@0.18.0" } }
  </script>
</head>
<body>
  <script type="module">
    import { exportToBlob } from "@excalidraw/excalidraw";
    
    window.exportPng = async (elements, opts = {}) => {
      const { scale = 2, padding = 20, background = true, backgroundColor = "#ffffff" } = opts;
      
      const blob = await exportToBlob({
        elements,
        appState: { exportScale: scale, exportBackground: background, viewBackgroundColor: backgroundColor },
        files: null,
        exportPadding: padding,
        mimeType: "image/png",
      });
      
      // Convert to base64 for transfer
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    };
    
    window.exportReady = true;
  </script>
</body>
</html>
```

### Key Differences from Current

| Aspect | Current | New |
|--------|---------|-----|
| Browser | Local Playwright | Browserbase (cloud) |
| Third-party | excalidraw.com API | None |
| Export method | Canvas screenshot | `exportToBlob` API |
| Framing | Keyboard shortcuts | `exportPadding` option |
| Resolution | Canvas size only | `exportScale` option |
| Convex-ready | No (needs local browser) | Yes (API calls only) |

---

## Environment Setup

### Already Configured
```
packages/backend/.env.local:
  BROWSERBASE_API_KEY=bb_live_HxzjbJ0I4UsT9KOiW05SpTrDF60
  BROWSERBASE_PROJECT_ID=6a5624bd-f239-435d-8a6f-ac3662f6d84c
```

### Dependencies Needed
```bash
cd packages/backend
bun add @browserbasehq/sdk playwright-core
```

### Convex Config (for future action)
```json
// convex.json
{
  "node": {
    "externalPackages": ["playwright-core", "@browserbasehq/sdk"]
  }
}
```

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **QA approach**: Visual comparison + manual inspection
- **Framework**: Manual verification of PNG output

### Validation Steps
1. Run spike experiment → verify PNG generated
2. Compare to current excalidraw.com output
3. Test at multiple scales (1x, 2x, 3x)
4. Verify no UI artifacts

---

## Task Flow

```
Task 0 (Install deps) → Task 1 (Spike) → Task 2 (Update render-png) → Task 3 (Validation)
                                                      ↓
                                              Task 4 (Cleanup)
```

## Parallelization

| Task | Depends On | Reason |
|------|------------|--------|
| 0 | None | Foundation |
| 1 | 0 | Needs deps |
| 2 | 1 | Needs validated approach |
| 3 | 2 | Needs new implementation |
| 4 | 3 | Cleanup after validation |

---

## TODOs

- [x] 0. Install Dependencies

  **What to do**:
  - Install `@browserbasehq/sdk` and `playwright-core`
  - Verify env vars are loaded correctly

  **Must NOT do**:
  - Install full `playwright` package (we want `-core` only)

  **Parallelizable**: NO (foundation)

  **Commands**:
  ```bash
  cd packages/backend
  bun add @browserbasehq/sdk playwright-core
  ```

  **Acceptance Criteria**:
  - [ ] `@browserbasehq/sdk` in package.json
  - [ ] `playwright-core` in package.json
  - [ ] `bun install` succeeds

  **Commit**: YES
  - Message: `chore(deps): add browserbase sdk and playwright-core`
  - Files: `packages/backend/package.json`

---

- [x] 1. Spike: Browserbase + Excalidraw Export

  **What to do**:
  - Create `packages/backend/experiments/tests/spike-browserbase-export.ts`
  - Connect to Browserbase via SDK
  - Inject export harness HTML via `page.setContent()`
  - Call `window.exportPng()` with test elements
  - Save resulting PNG to output folder
  - Document performance (time, file size)

  **Must NOT do**:
  - Full integration (just validate approach)
  - Complex diagrams (simple 2 rectangles + 1 arrow)

  **Parallelizable**: NO (validates approach)

  **References**:
  - Browserbase SDK: `@browserbasehq/sdk`
  - playwright-core: `chromium.connectOverCDP()`
  - Current elements format: `packages/backend/experiments/lib/render-png.ts:30-214`
  - Excalidraw exportToBlob: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export

  **Acceptance Criteria**:
  - [ ] Script runs without errors
  - [ ] PNG file generated in `output/spike-browserbase-export.png`
  - [ ] PNG contains visible diagram (2 rectangles, arrow, labels)
  - [ ] Performance logged (expect <15s including session creation)
  - [ ] Session replay viewable at Browserbase dashboard

  **Commit**: YES
  - Message: `feat(export): spike browserbase + excalidraw export`
  - Files: `packages/backend/experiments/tests/spike-browserbase-export.ts`

---

- [x] 2. Update render-png.ts to Use Browserbase

  **What to do**:
  - Refactor `renderDiagramToPng()` to use Browserbase instead of local Playwright
  - Create Browserbase session, connect via CDP
  - Inject export harness HTML via `page.setContent()`
  - Call `exportToBlob` via `page.evaluate()`
  - Implement `scale`, `padding`, `background` options
  - Remove excalidraw.com upload logic
  - Remove keyboard shortcut logic
  - Consider browser/session reuse for batch performance

  **Must NOT do**:
  - Change function signature (keep `RenderResult` interface)
  - Remove `renderExcalidrawUrlToPng()` yet
  - Break existing tests

  **Parallelizable**: NO (depends on spike)

  **References**:
  - Current implementation: `packages/backend/experiments/lib/render-png.ts:278-326`
  - Upload logic to remove: `packages/backend/experiments/lib/render-png.ts:216-264`
  - Keyboard shortcuts to remove: `packages/backend/experiments/lib/render-png.ts:310-314`
  - Spike implementation from task 1

  **Acceptance Criteria**:
  - [ ] `renderDiagramToPng()` works via Browserbase
  - [ ] No calls to excalidraw.com
  - [ ] No keyboard shortcuts
  - [ ] `scale` option functional (1, 2, 3)
  - [ ] `padding` option functional
  - [ ] `background` option functional
  - [ ] Existing tests pass
  - [ ] Performance: <10s per export

  **Commit**: YES
  - Message: `refactor(export): use browserbase for png export`
  - Files: `packages/backend/experiments/lib/render-png.ts`

---

- [x] 3. Validation: Visual Comparison

  **What to do**:
  - Generate baseline PNGs with current approach (before changes)
  - Generate same diagrams with new Browserbase approach
  - Compare side-by-side for fidelity
  - Test multiple diagram types
  - Document any visual differences

  **Must NOT do**:
  - Automated pixel diff (manual comparison sufficient)
  - Extensive test suite (representative samples)

  **Parallelizable**: NO (depends on task 2)

  **Acceptance Criteria**:
  - [ ] Baseline PNGs saved
  - [ ] New PNGs generated
  - [ ] Manual comparison: All elements present
  - [ ] Manual comparison: No UI artifacts
  - [ ] Manual comparison: Proper framing/padding
  - [ ] Scale test: 1x, 2x, 3x outputs correct

  **Commit**: YES
  - Message: `test(export): visual comparison validation`
  - Files: `packages/backend/experiments/tests/test-export-comparison.ts`

---

- [x] 4. Cleanup: Remove Old Code

  **What to do**:
  - Remove `uploadToExcalidraw()` function
  - Remove keyboard shortcut logic
  - Remove "Loading" wait logic
  - Clean up unused imports
  - Update `RenderResult.shareUrl` (optional or generate differently)

  **Must NOT do**:
  - Remove Playwright entirely (playwright-core still used)
  - Break existing callers

  **Parallelizable**: NO (after validation)

  **Acceptance Criteria**:
  - [ ] `uploadToExcalidraw()` removed
  - [ ] Keyboard shortcuts removed
  - [ ] File is cleaner
  - [ ] All tests pass

  **Commit**: YES
  - Message: `refactor(export): remove excalidraw.com upload code`
  - Files: `packages/backend/experiments/lib/render-png.ts`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 0 | `chore(deps): add browserbase sdk and playwright-core` | package.json | `bun install` |
| 1 | `feat(export): spike browserbase + excalidraw export` | spike-browserbase-export.ts | PNG generated |
| 2 | `refactor(export): use browserbase for png export` | render-png.ts | Tests pass |
| 3 | `test(export): visual comparison validation` | test-export-comparison.ts | Manual review |
| 4 | `refactor(export): remove excalidraw.com upload code` | render-png.ts | Tests pass |

---

## Success Criteria

### Verification Commands
```bash
# Install deps
cd packages/backend && bun add @browserbasehq/sdk playwright-core

# Run spike
bun packages/backend/experiments/tests/spike-browserbase-export.ts
# → Should create output/spike-browserbase-export.png

# Run existing tests (after refactor)
bun packages/backend/experiments/tests/test-visual-grading.ts

# Performance check
time bun packages/backend/experiments/tests/spike-browserbase-export.ts
# Expected: <15s (includes Browserbase session creation)
```

### Final Checklist
- [x] PNG export works via Browserbase (cloud browser)
- [x] Uses Excalidraw's official `exportToBlob` API
- [x] No excalidraw.com dependency
- [x] Resolution configurable via `scale` option
- [x] Padding configurable via `padding` option
- [x] No UI artifacts in output
- [x] 100% rendering fidelity with Excalidraw
- [x] Performance acceptable (<10s per export)
- [x] Convex-compatible (no local browser needed)

---

## Future: Convex Action (Not in This Plan)

Once validated, can create Convex action:

```typescript
// packages/backend/convex/exportDiagram.ts
"use node";

import { action } from "./_generated/server";
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";

export const exportToPng = action({
  args: { elements: v.array(v.any()), scale: v.optional(v.number()) },
  handler: async (ctx, { elements, scale = 2 }) => {
    // ... Browserbase + exportToBlob logic
    // Store in ctx.storage or return base64
  }
});
```

Requires `convex.json` config:
```json
{ "node": { "externalPackages": ["playwright-core", "@browserbasehq/sdk"] } }
```
