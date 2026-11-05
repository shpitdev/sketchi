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

/** The bare model id for a Google route, without its gateway routing prefix. */
export function stripGoogleModelPrefix(model: string): string {
	return model.replace(/^google-ai-studio\//, "").replace(/^google\//, "");
}
