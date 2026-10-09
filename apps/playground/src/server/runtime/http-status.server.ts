import "@tanstack/react-start/server-only";

const FAILURE_HTTP_STATUS = {
  invalid_input: 400,
  invalid_flowchart: 422,
  invalid_mindmap: 422,
  invalid_sequence: 422,
  invalid_canvas: 422,
  invalid_generated_document: 422,
  quality_failed: 422,
  unsupported_operation: 422,
  connectivity_changed: 422,
  unsupported_diagram_type: 422,
  malformed_output: 422,
  limit_exceeded: 413,
  not_found: 404,
  format_unavailable: 404,
  source_unavailable: 404,
  target_not_found: 404,
  expired: 410,
  render_failed: 500,
  export_failed: 500,
  storage_failed: 500,
  // Generation's upstream failures retain their existing gateway semantics.
  provider_failed: 502,
  generation_timeout: 504,
} satisfies Record<string, number>;

export function resultHttpStatus(
  result:
    | { readonly ok: true }
    | { readonly ok: false; readonly status: keyof typeof FAILURE_HTTP_STATUS },
): number {
  return result.ok ? 200 : FAILURE_HTTP_STATUS[result.status];
}
