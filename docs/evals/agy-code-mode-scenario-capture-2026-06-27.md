# Agy Code Mode Scenario Capture (2026-06-27)

This is a manual harness evidence report, not a new eval framework. The run used the authenticated Agy TUI in tmux as the primary visible surface.

| Field           | Value                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| Harness         | Agy TUI in tmux                                                                 |
| Model           | `gemini-3.5-flash`                                                              |
| Reasoning level | Medium, as shown in the Agy TUI header/footer                                   |
| MCP endpoint    | `https://sketchi-studio.dimethyl.workers.dev/mcp`                               |
| Local evidence  | `.memory/agy-scenario-suite/20260627T191702Z` from the original capture machine |

## Summary

- Fresh scenarios run: 10.
- Accepted Sketchi artifacts: 10/10.
- Hosted Excalidraw URL verification: 10/10 returned `200 application/vnd.excalidraw+json`.
- Hosted PNG URL verification: 10/10 returned `200 image/png`.
- Harness-visible repair loops: 3/10. Actor handoff and vague product hit `arrow_overlap` and recovered with left-to-right layout. Dense vendor onboarding failed the first attempt with multiple structural/layout errors and recovered with top-to-bottom layout.
- Local wrapper artifacts created by Agy: none observed in the Agy brain workspace.

## Results

| Scenario              | Complexity                        | Prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Harness | Model            | Reasoning | JSON                                                                                                                                          | PNG                                                                                                                                   | Verification                                                | Notes                                                                                   |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `simple-linear`       | simple linear flow                | simple online order fulfillment. Flow: order received, validate payment, reserve inventory, pick item, pack shipment, buy label, hand to carrier, notify customer, done. Keep it mostly linear with clear short node labels.                                                                                                                                                                                                                                                                                        | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_0e8b380c-96e1-4e34-a4a8-3eaf5efaf7f3?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_0e8b380c-96e1-4e34-a4a8-3eaf5efaf7f3?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | accepted on first execute                                                               |
| `basic-decision`      | basic decision tree               | support ticket triage with one clear decision. Flow: ticket received, gather account context, decision: severity high? If yes, page on-call, open incident channel, notify customer, done. If no, add reproduction notes, route to product queue, send normal response, done.                                                                                                                                                                                                                                       | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_41dc59bf-72de-4737-b3b1-b0f4dde1376c?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_41dc59bf-72de-4737-b3b1-b0f4dde1376c?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | accepted on first execute                                                               |
| `nested-decisions`    | nested decision workflow          | pharma batch disposition with nested decisions. Flow: batch record submitted, check record complete? If no, return to manufacturing for correction. If yes, review lab results. Decision: all tests pass? If no, open investigation and decision: investigation accepts batch? If no, reject batch and close. If yes, continue to QA review. Decision: QA approves release? If yes, release batch and notify warehouse. If no, hold batch for CAPA.                                                                 | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_9f660fe4-aee5-4cf9-aff3-c9b95753be80?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_9f660fe4-aee5-4cf9-aff3-c9b95753be80?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | accepted on first execute                                                               |
| `retry-loop`          | retry and loop workflow           | nightly customer CSV import with retry handling. Flow: scheduled import starts, download CSV, validate schema, decision: schema valid? If no, send correction request and end. If yes, transform rows, load into warehouse, decision: load succeeded? If yes, publish import summary and end. If no, increment retry count, decision: retries remaining? If yes, wait five minutes and retry load. If no, create incident and alert data owner.                                                                     | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_6aa7c10e-994b-4e00-8e00-27f208c70baa?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_6aa7c10e-994b-4e00-8e00-27f208c70baa?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | accepted on first execute                                                               |
| `lifecycle-state`     | lifecycle/state-machine flow      | SaaS subscription lifecycle. Include states and transitions: trial started, activated, invoice issued, decision: payment succeeds? If yes, account remains active. If no, enter grace period, send dunning email, decision: payment recovered? If yes, reactivate active subscription. If no, suspend account. From suspended, customer can update payment to reactivate or cancel to close account. Keep it readable as a state-machine-like flowchart.                                                            | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_af58f5b5-62ec-4851-91d7-51d2abebd490?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_af58f5b5-62ec-4851-91d7-51d2abebd490?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | accepted on first execute                                                               |
| `incident-escalation` | incident escalation               | production incident escalation. Flow: alert fires, automated checks collect context, decision: customer impact detected? If no, create low-priority ticket and monitor. If yes, assign severity, page primary responder, decision: acknowledged in five minutes? If no, page backup and manager. If yes, open incident channel, post status update, mitigate, decision: mitigated? If no, escalate to vendor or platform owner. If yes, resolve, publish postmortem tasks, close.                                   | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_ff4ba030-5f0e-4d36-872a-642df9cde35b?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_ff4ba030-5f0e-4d36-872a-642df9cde35b?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | accepted on first execute                                                               |
| `actor-handoff`       | actor handoff flow                | enterprise sales-to-implementation handoff. Show owner-prefixed nodes rather than swimlanes: Sales qualifies opportunity, Solutions scopes integration, Legal reviews contract, Finance approves billing terms, Customer signs order, Implementation schedules kickoff, Customer provides technical contacts, Implementation configures workspace, Customer validates launch checklist, Support takes over success handoff. Include one decision: contract approved? no loops back to Legal redline, yes continues. | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_4e305d5e-3296-41f4-9244-bfcc790089d4?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_4e305d5e-3296-41f4-9244-bfcc790089d4?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | first execute hit arrow_overlap; retry with LR layout accepted                          |
| `repo-architecture`   | repo/package architecture         | explains the Sketchi v2 package/app architecture. Keep it to 8-14 nodes. Include diagram-core, diagram-renderer, diagram-excalidraw, diagram-generation, diagram-agent, diagram-scenarios, diagram-studio-ui, apps/playground, apps/studio, apps/excalidraw, apps/web, and apps/icons if appropriate. Show the high-level flow from prompt/scenario to validated IR to rendered Excalidraw/PNG artifact and app surfaces.                                                                                           | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_39f2f91e-8473-4c5a-8c16-be938f999380?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_39f2f91e-8473-4c5a-8c16-be938f999380?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | inspected repo docs/files; accepted on first execute                                    |
| `dense-business`      | dense 10-15 node business process | enterprise vendor onboarding with 12-15 meaningful nodes. Include intake request, requester details, vendor risk screening, decision: high risk? If yes, security questionnaire, legal review, finance tax review, procurement approval, executive approval if spend is above threshold, purchase order creation, vendor portal invitation, bank validation, first invoice match, activate vendor, and archive onboarding evidence. Keep the branches readable and avoid unnecessary transitive edges.              | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_2b40bea2-45d6-4a80-aabc-3beca18e92dd?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_2b40bea2-45d6-4a80-aabc-3beca18e92dd?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | first execute returned multiple structural/layout errors; retry with TB layout accepted |
| `vague-product`       | vague product/architecture prompt | I want agents to take messy user requests, create correct diagrams, avoid fake/local artifacts, and leave enough proof that we can evaluate real usage later. Make the diagram show the inferred product flow and feedback loop without asking me clarifying questions.                                                                                                                                                                                                                                             | agy     | gemini-3.5-flash | Medium    | [JSON](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_ba797367-8c78-47df-951e-68e2b1c8fd12?format=excalidraw&raw=true) | [PNG](https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/artifact_ba797367-8c78-47df-951e-68e2b1c8fd12?format=png&raw=true) | JSON 200 application/vnd.excalidraw+json; PNG 200 image/png | first execute hit arrow_overlap; retry with LR layout accepted                          |

## Observations

- The final artifact-delivery contract is working well for this Agy surface: every accepted artifact included both raw Excalidraw JSON and PNG URLs.
- The main failure class surfaced here is deterministic layout validation, especially `arrow_overlap` on denser or handoff-style graphs. Agy recovered by changing layout direction rather than creating local artifacts.
- Agy's TUI redraws duplicate terminal text, so terminal scraping is not a good long-term eval substrate. The saved MCP output files were much cleaner than pane logs.
- Repo-aware prompting worked: Agy inspected local repo docs/files for the architecture scenario, then still returned only the hosted Sketchi artifact.
- The next product step should preserve real MCP usage server-side so prompts, harness/client metadata, model, reasoning level, tool attempts, intermediate issues, final artifact refs, timings, and token/cost fields do not have to be reconstructed from local TUI state.

## Exact Prompts

<details>
<summary><code>simple-linear</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: simple online order fulfillment. Flow: order received, validate payment, reserve inventory, pick item, pack shipment, buy label, hand to carrier, notify customer, done. Keep it mostly linear with clear short node labels. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>basic-decision</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: support ticket triage with one clear decision. Flow: ticket received, gather account context, decision: severity high? If yes, page on-call, open incident channel, notify customer, done. If no, add reproduction notes, route to product queue, send normal response, done. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>nested-decisions</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: pharma batch disposition with nested decisions. Flow: batch record submitted, check record complete? If no, return to manufacturing for correction. If yes, review lab results. Decision: all tests pass? If no, open investigation and decision: investigation accepts batch? If no, reject batch and close. If yes, continue to QA review. Decision: QA approves release? If yes, release batch and notify warehouse. If no, hold batch for CAPA. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>retry-loop</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: nightly customer CSV import with retry handling. Flow: scheduled import starts, download CSV, validate schema, decision: schema valid? If no, send correction request and end. If yes, transform rows, load into warehouse, decision: load succeeded? If yes, publish import summary and end. If no, increment retry count, decision: retries remaining? If yes, wait five minutes and retry load. If no, create incident and alert data owner. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>lifecycle-state</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: SaaS subscription lifecycle. Include states and transitions: trial started, activated, invoice issued, decision: payment succeeds? If yes, account remains active. If no, enter grace period, send dunning email, decision: payment recovered? If yes, reactivate active subscription. If no, suspend account. From suspended, customer can update payment to reactivate or cancel to close account. Keep it readable as a state-machine-like flowchart. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>incident-escalation</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: production incident escalation. Flow: alert fires, automated checks collect context, decision: customer impact detected? If no, create low-priority ticket and monitor. If yes, assign severity, page primary responder, decision: acknowledged in five minutes? If no, page backup and manager. If yes, open incident channel, post status update, mitigate, decision: mitigated? If no, escalate to vendor or platform owner. If yes, resolve, publish postmortem tasks, close. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>actor-handoff</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: enterprise sales-to-implementation handoff. Show owner-prefixed nodes rather than swimlanes: Sales qualifies opportunity, Solutions scopes integration, Legal reviews contract, Finance approves billing terms, Customer signs order, Implementation schedules kickoff, Customer provides technical contacts, Implementation configures workspace, Customer validates launch checklist, Support takes over success handoff. Include one decision: contract approved? no loops back to Legal redline, yes continues. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>repo-architecture</code></summary>

```text
Use sketchi-code-mode to inspect this repository only as needed and create a Sketchi flowchart artifact that explains the Sketchi v2 package/app architecture. Keep it to 8-14 nodes. Include diagram-core, diagram-renderer, diagram-excalidraw, diagram-generation, diagram-agent, diagram-scenarios, diagram-studio-ui, apps/playground, apps/studio, apps/excalidraw, apps/web, and apps/icons if appropriate. Show the high-level flow from prompt/scenario to validated IR to rendered Excalidraw/PNG artifact and app surfaces. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>dense-business</code></summary>

```text
Use sketchi-code-mode to create a Sketchi flowchart artifact for this scenario: enterprise vendor onboarding with 12-15 meaningful nodes. Include intake request, requester details, vendor risk screening, decision: high risk? If yes, security questionnaire, legal review, finance tax review, procurement approval, executive approval if spend is above threshold, purchase order creation, vendor portal invitation, bank validation, first invoice match, activate vendor, and archive onboarding evidence. Keep the branches readable and avoid unnecessary transitive edges. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>

<details>
<summary><code>vague-product</code></summary>

```text
Use sketchi-code-mode to turn this vague product request into a useful Sketchi flowchart artifact: I want agents to take messy user requests, create correct diagrams, avoid fake/local artifacts, and leave enough proof that we can evaluate real usage later. Make the diagram show the inferred product flow and feedback loop without asking me clarifying questions. Request scene, excalidraw, and png formats. Do not create local files, Markdown wrappers, Mermaid, or raw Excalidraw. When Sketchi returns artifactDelivery, paste the exact Sketchi artifact ready block with artifact ID, diagram ID, formats, Excalidraw URL, and PNG URL, then stop.
```

</details>
