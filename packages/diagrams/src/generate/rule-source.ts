/**
 * How a surface names the text a diagram comes from: the MCP docs say "the prompt", Studio chat
 * "the user", and the generation prompt "the scenario" for flowcharts and "the source" for the
 * families whose rules were tuned with that word. A rule that names it takes the
 * surface's word, so one sentence serves all three.
 */
export type RuleSource = "the prompt" | "the scenario" | "the source" | "the user";

/** A rule sentence that names where the diagram's content comes from. */
export type SourcedRule = (source: RuleSource) => string;

/** "the prompt" → "The prompt", for a rule that opens a sentence with it. */
export function capitalized(text: string): string {
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
