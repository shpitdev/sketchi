# Agy Code Mode Current Suite (2026-07-10)

This is a live harness evidence report for the current Agy CLI flow against the
production Sketchi MCP endpoint. It closes the earlier Agy evidence gap from
PR 68 by distinguishing harness issues from product geometry failures.

| Field | Value |
| --- | --- |
| Harness | Agy CLI via `tools/harness-eval.ts` |
| Model | `gemini-3.5-flash` |
| MCP endpoint | `https://sketchi-studio.dimethyl.workers.dev/mcp` |
| Command | `pnpm eval:harness -- --harness antigravity --all --timeout-ms 180000` |
| Local report | `.memory/agy-current-2026-07-10-all-patched/report.json` |
| Generated at | `2026-07-10T11:36:39.331Z` |
| Scenarios | 22 |
| Passing evaluations | 22 |
| Failed evaluations | 0 |
| MCP tool calls | 114 |
| Total duration | 474268 ms |
| Timeouts | 0 |
| Wrapper artifacts | 0 |
| Local Excalidraw validation issues | 0 |
| Hosted Excalidraw/PNG URL check | 44/44 returned `200` |

## Summary

- Agy auth was available, but the inherited agent shell did not include
  `/home/anandpant/.local/bin`, where the `agy` binary lives. The harness now
  passes a child `PATH` that includes the local user bin and the active Node bin.
- A first full run reached the live MCP and produced 21/22 accepted evaluations.
  The only failure, `loan-application-underwriting`, was a harness-grader
  mismatch: Agy returned a valid public `FlowchartSpec`-style `normalizedSpec`
  with optional edge IDs omitted, while the grader required them before
  normalizing.
- The captured `loan-application-underwriting` conversation replay passed after
  the grader normalized missing edge IDs the same way Code Mode runtime does.
- A fresh full suite after that fix passed 22/22 with 114 MCP tool calls. There
  were no timeouts, no local wrapper artifacts, and no local Excalidraw
  validation issues from harness grading.
- A live HTTP check against every final Excalidraw and PNG URL returned `200`
  for all 44 URLs. That proves hosted artifact liveness; geometry assertions
  come from the harness's local validation of the returned specs.
- The current evidence does not support a new renderer or Excalidraw regression
  in this slice. The only code changes are harness child-path hardening and
  grader acceptance of optional public edge IDs.

## Diagnostic Runs

| Run | Purpose | Result |
| --- | --- | --- |
| `.memory/agy-current-2026-07-10-smoke/report.json` | Reproduce current smoke behavior with an explicit working `PATH`. | Passed. |
| `.memory/agy-path-regression-2026-07-10/report.json` | Prove the harness supplies Agy's local tool path even when the parent `PATH` omits it. | Passed. |
| `.memory/agy-current-2026-07-10-all/report.json` | Full live suite before the edge-ID grading fix. | 21/22; only `loan-application-underwriting` failed on missing optional edge IDs. |
| `.memory/agy-current-2026-07-10-loan-replay/report.json` | Replay the captured failing loan conversation with the fixed grader. | Passed. |
| `.memory/agy-current-2026-07-10-all-patched/report.json` | Fresh full live suite after both fixes. | Passed 22/22. |

## Results

| Scenario | Artifact | MCP calls | Duration |
| --- | --- | ---: | ---: |
| `sketchi-onboarding-decision-flow` | [artifact_402efa73-cfc5-45b9-94b5-9a7a511cc2f3](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_402efa73-cfc5-45b9-94b5-9a7a511cc2f3?format=excalidraw&raw=true) | 5 | 22204 ms |
| `pharma-batch-disposition` | [artifact_a8ffd82b-bd2f-4e76-b8f2-eb0544e4d2a8](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_a8ffd82b-bd2f-4e76-b8f2-eb0544e4d2a8?format=excalidraw&raw=true) | 4 | 20885 ms |
| `repo-package-interaction-flow` | [artifact_00bf2599-d7d3-44da-bb90-b0c5224ff9ff](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_00bf2599-d7d3-44da-bb90-b0c5224ff9ff?format=excalidraw&raw=true) | 4 | 19346 ms |
| `support-ticket-triage` | [artifact_84b63506-a7b6-42ee-8d1b-19ed8cb26070](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_84b63506-a7b6-42ee-8d1b-19ed8cb26070?format=excalidraw&raw=true) | 5 | 21972 ms |
| `ecommerce-return-authorization` | [artifact_c0af3e71-61f0-4794-afbe-d5f2f947d84a](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_c0af3e71-61f0-4794-afbe-d5f2f947d84a?format=excalidraw&raw=true) | 5 | 22127 ms |
| `incident-escalation` | [artifact_137fdc6b-f8e7-4c8a-be12-017fcd925d19](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_137fdc6b-f8e7-4c8a-be12-017fcd925d19?format=excalidraw&raw=true) | 5 | 22545 ms |
| `incident-response-code-mode-proof` | [artifact_523e05b1-42e0-4cf2-b4b1-c7643f9f3c67](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_523e05b1-42e0-4cf2-b4b1-c7643f9f3c67?format=excalidraw&raw=true) | 6 | 31568 ms |
| `invoice-approval` | [artifact_ee40bc91-0f96-4d25-a99e-ab71c0219e48](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_ee40bc91-0f96-4d25-a99e-ab71c0219e48?format=excalidraw&raw=true) | 5 | 19499 ms |
| `feature-flag-rollout` | [artifact_28c6278a-0c02-4558-83c9-f65a1048bcc7](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_28c6278a-0c02-4558-83c9-f65a1048bcc7?format=excalidraw&raw=true) | 5 | 20489 ms |
| `patient-intake-scheduling` | [artifact_c0118610-f7ed-4735-a655-876ff92aae10](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_c0118610-f7ed-4735-a655-876ff92aae10?format=excalidraw&raw=true) | 4 | 19744 ms |
| `content-moderation` | [artifact_d0c6c57b-9828-44b4-ac72-8cfae1c3590c](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_d0c6c57b-9828-44b4-ac72-8cfae1c3590c?format=excalidraw&raw=true) | 5 | 17920 ms |
| `data-import-validation` | [artifact_789f675c-c576-4247-a930-c9f726d9ac79](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_789f675c-c576-4247-a930-c9f726d9ac79?format=excalidraw&raw=true) | 5 | 23535 ms |
| `password-reset-security` | [artifact_7f290544-cf65-431d-96ac-6c274c34ffde](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_7f290544-cf65-431d-96ac-6c274c34ffde?format=excalidraw&raw=true) | 5 | 18976 ms |
| `warehouse-reorder` | [artifact_1a6b3067-afde-4333-bc13-9f02e70a6818](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_1a6b3067-afde-4333-bc13-9f02e70a6818?format=excalidraw&raw=true) | 10 | 26093 ms |
| `loan-application-underwriting` | [artifact_53c45867-6ba6-4c62-978a-0aa26ab4a1f8](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_53c45867-6ba6-4c62-978a-0aa26ab4a1f8?format=excalidraw&raw=true) | 5 | 23012 ms |
| `customer-offboarding-retention` | [artifact_29bd9634-e220-4440-b1b9-a067567b7826](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_29bd9634-e220-4440-b1b9-a067567b7826?format=excalidraw&raw=true) | 5 | 16736 ms |
| `bug-report-routing` | [artifact_d946a4ed-a732-45d4-9c93-feee09280a5b](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_d946a4ed-a732-45d4-9c93-feee09280a5b?format=excalidraw&raw=true) | 5 | 20903 ms |
| `expense-reimbursement` | [artifact_ebb101f9-e95b-4492-9e87-c444628b07f0](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_ebb101f9-e95b-4492-9e87-c444628b07f0?format=excalidraw&raw=true) | 5 | 23171 ms |
| `restaurant-waitlist` | [artifact_afdd9ee6-8178-41a4-9aa3-bdee7e6850fa](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_afdd9ee6-8178-41a4-9aa3-bdee7e6850fa?format=excalidraw&raw=true) | 6 | 17912 ms |
| `ci-release-gate` | [artifact_ef7135a2-aed0-46c9-8512-f0f9fac7096f](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_ef7135a2-aed0-46c9-8512-f0f9fac7096f?format=excalidraw&raw=true) | 5 | 19378 ms |
| `procurement-vendor-approval` | [artifact_b064cabf-cb33-47eb-a83f-7a2044a72fe4](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_b064cabf-cb33-47eb-a83f-7a2044a72fe4?format=excalidraw&raw=true) | 5 | 23370 ms |
| `subscription-renewal-dunning` | [artifact_edc65b1b-6f2c-40b1-b140-a7e38e0f4744](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_edc65b1b-6f2c-40b1-b140-a7e38e0f4744?format=excalidraw&raw=true) | 5 | 22883 ms |
