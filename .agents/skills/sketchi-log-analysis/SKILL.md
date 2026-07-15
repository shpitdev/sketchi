---
name: sketchi-log-analysis
description: Analyze Sketchi playground Cloudflare AI Gateway logs for prompt tuning, Gemini flowchart IR reliability, retained request/response payloads, and scenario regression evidence. Use when inspecting google-ai-studio Gateway logs, validating generated Sketchi IR, or turning model failures into scenario or prompt changes.
---

# Sketchi Log Analysis

Use this skill to inspect Sketchi playground AI Gateway logs through the
Cloudflare API MCP. Keep the workflow read-only.

## Cloudflare MCP

Use the Cloudflare API MCP server:

```json
{
  "mcpServers": {
    "cloudflare-api": {
      "url": "https://mcp.cloudflare.com/mcp"
    }
  }
}
```

The target Gateway is usually `google-ai-studio` in the Sketchi Cloudflare
account.

## Workflow

1. Use the Cloudflare API MCP to find the AI Gateway log endpoints if needed.
2. List recent logs for `google-ai-studio` with a small page size first.
3. Prefer non-cached logs when evaluating model behavior.
4. Read log detail for useful samples.
5. Prefer retained detail fields such as `request_head` and `response_head` when
   they are marked complete.
6. Use separate request/response payload endpoints only when detail does not
   include enough retained payload data.
7. Parse the retained response into candidate Sketchi IR and classify it.
8. Report concrete follow-up: scenario assertion, prompt change, deterministic
   converter issue, or Gateway/provider issue.

Do not mutate Cloudflare resources. Do not delete logs. Do not print secrets,
provider credentials, bearer tokens, or full unrelated payloads.

## Report Fields

For each relevant request, report:

- Timestamp, model, provider route, status, latency, and token usage.
- Scenario ID or scenario title from request metadata or payload.
- Whether request and response payloads were retained.
- Whether the request has a true system/user split.
- Whether the system prompt contains the flowchart IR rules.
- Whether the user prompt avoids duplicating the flowchart IR rules.
- Whether the model response was valid JSON.
- Whether the response satisfied the flowchart IR contract.
- Any recurring failure pattern that should become a scenario assertion or
  prompt change.

## Flowchart IR Contract

Classify a candidate as `pass` only when all of these are true:

- `type` is `flowchart`.
- Exactly one node has `kind: "start"`.
- At least one node has `kind: "end"`.
- Every node has `id`, `label`, and `kind`.
- Every edge uses existing `source` and `target` node IDs.
- Every non-end node has at least one outgoing edge.
- End nodes have zero outgoing edges.
- Every decision node has at least two outgoing edges.
- Every outgoing edge from a decision node has a non-empty unique label.

Use `prompt-risk` when JSON and contract shape are valid but scenario semantics
are missing or ambiguous. Use `contract-fail` for typed IR violations. Use
`gateway-fail` for auth, provider, route, timeout, or Gateway failures that
prevent evaluation.
