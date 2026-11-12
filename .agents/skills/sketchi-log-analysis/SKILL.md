---
name: sketchi-log-analysis
description: "Investigate Sketchi generations and Code Mode calls in the span telemetry with DuckDB (`pnpm db`): failures, repairs, token and time cost, coverage issues, and the model output behind them. Use when debugging a generate or MCP result, or when turning failures into eval cases or prompt changes."
---

# Sketchi log analysis

Every Sketchi Worker request records its spans, including full prompts and outputs, in an R2 Data Catalog table. `pnpm db` opens DuckDB on that table from the repository root. Keep the work read-only.

## Open the data

```sh
pnpm db                                 # production, interactive
pnpm db --preview                       # PR previews
pnpm db -c "FROM generations LIMIT 5"   # one query
```

It needs a read-only `R2_DATA_READ_TOKEN`; when the variable is unset, `pnpm db` gets one from Infisical. A request's rows arrive about a minute after it ends.

## Views

| View                               | One row per                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `generations`                      | `/api/v1/generate` run: prompt, model, diagram type, output text, diagnostics, coverage issues, model calls, repairs, tokens, time |
| `usage_events`, `usage_issues`     | Code Mode call (MCP `execute`, API build, patch or canvas), and each issue it reported, with the request and response               |
| `spans`, `span_tree('<trace_id>')` | span; one trace, indented by parent                                                                                                |
| `slowest_spans`, `span_durations`  | span name over the last seven days, by duration                                                                                    |

## Workflow

1. Find the runs. Filter `generations` by `start_time`, `outcome`, `diagram_type` or `prompt ILIKE '%…%'`, or `usage_events` by `operation`, `status` or `harness`. Requests from a test harness carry their `client` and `scenario_id`.
2. Read the cost beside the result: `model_calls`, `repairs`, `total_tokens` and `duration_ms`. A pass that needed repairs still costs more than one that did not.
3. Open the trace with `span_tree(trace_id)` to see the order of model calls, repairs and coverage checks.
4. Read the model's answer in `output`. Generate calls `anthropic/claude-haiku-5-5` through Cloudflare AI Gateway. A flowchart comes back as its document, `{ title, diagram: { type: "flowchart", nodes: { id: label | { label, … } }, edges: [[from, to, label?]], groups?, lanes? } }`. Compare it with the prompt, then read `diagnostics` and `coverage_issues` for what Sketchi caught.
5. Classify each failure and name the follow-up:
   - model: valid output that misses or invents something the prompt states. Add an eval case, and a prompt rule if it recurs.
   - contract: the output fails the schema or validation. Check whether the prompt states the rule it broke.
   - layout: the diagram is right but draws badly. Add a renderer fuzz or scenario case.
   - gateway: provider, auth or timeout errors (`error_tag`, `failed_calls`).

## Report

For each run give the time, model, outcome, `model_calls`, `repairs`, tokens, duration and trace id, with one line on what went wrong. Quote only the parts of prompts and outputs that show it, and never print tokens or credentials.
