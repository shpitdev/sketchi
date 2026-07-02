# Agy Layout RCA Loop

## Objective

Make Sketchi Code Mode reliable with Agy and weak models by moving layout and
connector correctness into deterministic code. Agents should provide semantic
graph intent: nodes, edges, labels, and requested formats. They should not have
to choose connector ports, anchor points, manual coordinates, routing lanes, or
layout workarounds.

## Current Evidence

- Source report:
  [Agy Code Mode Scenario Capture](../evals/agy-code-mode-scenario-capture-2026-06-27.md).
- Fresh scenarios: 10.
- Accepted hosted artifacts: 10/10.
- Hosted Excalidraw JSON URLs: 10/10 returned `200`.
- Hosted PNG URLs: 10/10 returned `200`.
- Repair loops: 3/10.
- Main issue class: `arrow_overlap` and dense or handoff-style routing defects.
- Observed recoveries changed layout direction, which is useful evidence but
  should not be the durable product answer.

## Reproduced Failure Signatures

- Actor handoff first attempt:
  - Saved Agy output:
    `~/.gemini/antigravity-cli/brain/d59d9c7d-02d6-4d09-9030-b48b56c56acc/.system_generated/steps/56/output.txt`.
  - Result: `export_failed`.
  - Issue: `arrow_overlap`, `Arrow "edge:edge-5" overlaps arrow "edge:edge-6".`
  - Shape: a top-to-bottom feedback edge from `legal_redline` back to
    `legal_review` overlaps the forward branch from `contract_approved` to
    `finance_approve`.
- Vague product first attempt:
  - Saved Agy output:
    `~/.gemini/antigravity-cli/brain/d59d9c7d-02d6-4d09-9030-b48b56c56acc/.system_generated/steps/94/output.txt`.
  - Result: `export_failed`.
  - Issue: `arrow_overlap`, `Arrow "edge:edge-5" overlaps arrow "edge:edge-6".`
  - Shape: a top-to-bottom feedback edge from `agent_repair` back to
    `agent_orchestration` overlaps the forward branch from `ir_valid` to
    `scene_rendering`.
- Dense vendor onboarding first attempt:
  - Saved Agy output:
    `~/.gemini/antigravity-cli/brain/d59d9c7d-02d6-4d09-9030-b48b56c56acc/.system_generated/steps/82/output.txt`.
  - Result: `export_failed`.
  - Issues: repeated `export_invalid_scene` route-through-node reports.
  - Shape: left-to-right shortcut edges such as `high_risk -> legal_review`
    and `spend_threshold -> po_creation` are routed through unrelated row
    nodes instead of taking a clear deterministic lane.

## Working RCA Hypothesis

The likely problem is in deterministic scene routing and connector selection,
not in Agy intelligence.

Sketchi already owns the connector endpoints:

- `packages/diagram-renderer/src/scene.ts` chooses source and target edges,
  computes port offsets, and emits route points.
- `packages/diagram-excalidraw/src/lib/diagram-excalidraw.ts` converts those
  route points into Excalidraw arrow bindings.

Therefore the fix should improve renderer/excalidraw geometry and validation.
Prompting Agy to pick better anchors, choose manual coordinates, or retry with
layout directions is not acceptable as the primary fix.

The first code areas to inspect and change are:

- `connectionEdges` in `packages/diagram-renderer/src/scene.ts`, which chooses
  source and target sides from center deltas.
- `portOffsetsForRoutes` in `packages/diagram-renderer/src/scene.ts`, which
  currently assigns offsets per node side from route order rather than sorting
  by the opposite endpoint.
- `arrowForRoute` and `exteriorLaneRoute` in
  `packages/diagram-renderer/src/scene.ts`, which choose orthogonal lanes and
  fallback exterior lanes.
- `validateExcalidrawScene` in
  `packages/diagram-excalidraw/src/lib/diagram-excalidraw.ts`, which already
  catches overlapping segments, route-through-node defects, endpoint-off-shape
  defects, and broken elbow metadata.

## First Fix Slice

The first implementation slice should remove the observed Agy failure classes
without pretending the entire routing system is finished:

- Route upward feedback edges through scored exterior lanes instead of lanes
  derived only from the source and target pair.
- Let exterior fallback routing consider both left/right and top/bottom
  candidates, scoring by node crossings first and route length second.
- Send lateral upward feedback out of the source side and into the target bottom
  so repair-loop nodes do not share a top stem with incoming edges.
- Add exact normalized-spec regression tests for the Agy feedback-loop and
  left-to-right skip-edge failures.
- Keep the broader connector-side scoring work visible for the next loop.

## PR 68 Evidence

- Branch: `fix/agy-layout-routing`.
- Preview MCP attempted:
  `https://sketchi-studio-pr-68.dimethyl.workers.dev/mcp`.
- Local exact-shape rerun: the three saved Agy failure specs now validate with
  no `arrow_overlap` or route-through-node issues.
- Local maintained-package gates pass: renderer, excalidraw, agent, scenarios,
  full Nx `typecheck,test,build`, and Storybook.
- GitHub checks pass on PR 68, including preview deploys and `verify`.
- Live Agy preview rerun was attempted with the repo harness:
  `pnpm eval:harness -- --harness antigravity --model gemini-3.5-flash --all`.
  It did not reach Sketchi: Agy CLI OAuth timed out, and the report recorded
  `mcpToolCallCount: 0`.
- Saved local evidence:
  `.memory/agy-layout-pr-68-harness-report.json` and
  `.memory/agy-layout-pr-68-events/`.

## RCA Questions

- Are source and target connector sides always selected by Sketchi code, not by
  generated specs or harness prompts?
- When two nodes are offset diagonally, does the renderer choose the closest
  compatible side rather than defaulting to a visually wrong side?
- Do port offsets and lane choices prevent edge stems from stacking on top of
  each other in dense fan-in/fan-out cases?
- Does validation catch arrows that are technically bound but visually
  suboptimal, such as a connector attached to a far side when a nearer side is
  available?
- Can the known Agy repair-loop shapes be reproduced with deterministic
  fixtures before rerunning the live harness?

## Fix Principles

- Prefer closest-compatible side or port selection in code.
- Avoid creating long routes that attach to a visually wrong side when a closer
  side is available.
- Preserve semantic graph structure; do not ask the model to simplify valid
  dense workflows just to make routing easier.
- Add regression diagrams that generalize the failure shape instead of copying
  only the exact Agy prompts.
- Keep evals lightweight: Agy only for this loop, plus deterministic fixture
  tests that make failures local.
- Stop before overfitting: a fix should improve classes such as multi-rank
  branches, fan-in/fan-out, feedback loops, and dense handoff graphs.

## Execution Loop

1. Reproduce the current failures locally with deterministic diagrams matching
   the Agy failure classes.
2. Add focused renderer/excalidraw tests that fail for suboptimal connector
   side choice, route-through-node defects, and overlapping arrow segments.
3. Fix deterministic route selection incrementally: start with feedback and
   skip-edge classes, then move toward connector side scoring by candidate route
   quality rather than prompt-visible port choices.
4. Sort port offsets by the opposite endpoint coordinate so multiple edges on a
   side fan out predictably instead of depending on arbitrary edge order.
5. Score candidate orthogonal lanes before accepting a route: prefer no node
   crossings, then shorter route length, then fewer segment overlaps, then
   stable deterministic tie-breakers.
6. Tighten Excalidraw validation only where it catches real bad geometry.
7. Run package tests for renderer, excalidraw, agent runtime, and scenarios.
8. Rerun the Agy scenario set with the same weak-model setup.
9. Record the before/after evidence in `docs/evals/`.
10. Repeat until failures are meaningfully reduced without adding prompt hacks
    or stronger-harness masking.

## Non-Goals For This Loop

- Do not switch to stronger models to make failures disappear.
- Do not expand to Codex, Claude Code, or OpenCode until the Agy loop is stable.
- Do not add a broad eval framework; use deterministic tests plus focused Agy
  reruns.
- Do not ask the model to choose coordinates, connector sides, anchor points, or
  routing lanes.

## Acceptance Criteria

- Agy remains the primary live harness for this loop.
- Existing successful scenarios stay successful.
- The three known repair-loop classes no longer require layout-direction
  workarounds in normal runs.
- New tests prove connector endpoints are selected by Sketchi and are visually
  reasonable for dense graphs.
- The final report distinguishes product fixes from model retries.
