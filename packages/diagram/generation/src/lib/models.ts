/** Every model a generate request may name. Adding a model here is the whole change. */
export const SUPPORTED_GENERATION_MODELS = ["gemini-3.1-flash-lite"] as const;

type SupportedModelId = (typeof SUPPORTED_GENERATION_MODELS)[number];

/** A supported model id, bare or with its gateway routing prefix. */
export type SupportedGenerationModel =
	| SupportedModelId
	| `google/${SupportedModelId}`
	| `google-ai-studio/${SupportedModelId}`;

const SUPPORTED_SPELLINGS: ReadonlySet<string> = new Set(
	SUPPORTED_GENERATION_MODELS.flatMap((id) => [id, `google/${id}`, `google-ai-studio/${id}`]),
);

export function isSupportedGenerationModel(model: string): model is SupportedGenerationModel {
	return SUPPORTED_SPELLINGS.has(model);
}

/**
 * Installed CLIs send this id on every request, whether or not the user chose it, so
 * naming it means the same as naming nothing: the deployment's configured model.
 */
export function isLegacyCliDefaultModel(model: string): boolean {
	return stripGoogleModelPrefix(model) === "gemini-3.1-flash-lite";
}

/** The bare model id for a Google route, without its gateway routing prefix. */
export function stripGoogleModelPrefix(model: string): string {
	return model.replace(/^google-ai-studio\//, "").replace(/^google\//, "");
}

/** The bare model id for an Anthropic route, without its gateway routing prefix. */
export function stripAnthropicModelPrefix(model: string): string {
	return model.replace(/^anthropic\//, "");
}
