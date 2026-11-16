import { DIAGRAM_AGENT_SYSTEM_PROMPT } from "@sketchi/diagrams/build/policy";
/**
 * Studio's system prompt, plus the logos the user named. The model may only use
 * those slugs; anything else is dropped before the build.
 */
export function studioSystemPrompt(
	logos: readonly { readonly name: string; readonly slug: string }[],
): string {
	if (logos.length === 0) return DIAGRAM_AGENT_SYSTEM_PROMPT;
	return [
		DIAGRAM_AGENT_SYSTEM_PROMPT,
		"",
		"NODE LOGOS",
		`- Logos for technologies the user named: ${logos
			.map((logo) => `${logo.slug} (${logo.name})`)
			.join(", ")}.`,
		"- In a flowchart, set logos: true and keep each technology's name in its node label; the logo follows the label.",
		`- When a sequence participant is about one of these technologies, set its icon to { "slug": "<slug>" } with a slug from this list exactly, and keep the technology's name in its label. Leave icon off every other participant. Never invent a slug.`,
	].join("\n");
}
