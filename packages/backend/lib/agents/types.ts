import type { IntermediateFormat } from "../diagram-intermediate";

/**
 * Represents a validation error that occurred during diagram validation.
 * Used to communicate specific issues with schema, references, or semantic constraints.
 */
export interface ValidationError {
  /** Human-readable error message */
  message: string;
  /** Optional path to the problematic element (e.g., "nodes[0].id" or "edges[1].fromId") */
  path?: string;
  /** Optional suggestion for fixing the error */
  suggestion?: string;
  /** The category of validation error */
  type: "schema" | "reference" | "semantic";
}

/**
 * Result of a validation operation on diagram data.
 * Indicates whether validation passed and provides detailed error information if it failed.
 */
export interface ValidationResult {
  /** Array of validation errors if validation failed; undefined if ok=true */
  errors?: ValidationError[];
  /** Whether validation succeeded (true) or failed (false) */
  ok: boolean;
}

/**
 * Configuration profile for a prompt-based diagram agent.
 * Defines how an agent should interpret natural language and validate generated diagrams.
 */
export interface PromptAgentProfile {
  /** Human-readable description of what this agent specializes in */
  description: string;
  /** Unique identifier for this agent profile */
  id: string;
  /** System instructions that guide the agent's behavior and output format */
  instructions: string;
  /**
   * Optional validation function to check generated intermediate format.
   * Called after diagram generation to ensure semantic correctness.
   * @param intermediate The generated diagram in intermediate format
   * @returns Validation result with any errors found
   */
  validate?: (intermediate: IntermediateFormat) => ValidationResult;
}

/**
 * Result of a successful diagram generation from a natural language prompt.
 * Contains the generated diagram, metadata about the generation process, and tracing information.
 */
export interface GenerateIntermediateResult {
  /** Total time taken for generation in milliseconds */
  durationMs: number;
  /** The generated diagram in intermediate format (nodes, edges, options) */
  intermediate: IntermediateFormat;
  /** Number of iterations/refinements performed during generation */
  iterations: number;
  /** ID of the agent profile that was used for generation */
  profileId: string;
  /** Total tokens consumed by the LLM during generation */
  tokens: number;
  /** Trace ID for debugging and monitoring the generation request */
  traceId: string;
}
