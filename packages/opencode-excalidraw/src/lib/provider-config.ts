import type { Config } from "@opencode-ai/plugin";

export const SKETCHI_AUTH_PROVIDER_ID = "sketchi";

const SKETCHI_AUTH_MODEL_ID = "auth";

export function applySketchiAuthProviderConfig(config: Config): void {
  const existingProviderConfig = config.provider?.[SKETCHI_AUTH_PROVIDER_ID];

  config.provider = {
    ...config.provider,
    [SKETCHI_AUTH_PROVIDER_ID]: {
      id: SKETCHI_AUTH_PROVIDER_ID,
      name: "Sketchi",
      api: "https://www.sketchi.app",
      npm: "@ai-sdk/openai-compatible",
      ...existingProviderConfig,
      models: {
        ...existingProviderConfig?.models,
        [SKETCHI_AUTH_MODEL_ID]: {
          id: SKETCHI_AUTH_MODEL_ID,
          name: "Sketchi Auth",
          status: "deprecated",
          limit: {
            context: 1,
            output: 1,
          },
          cost: {
            input: 0,
            output: 0,
          },
          modalities: {
            input: ["text"],
            output: ["text"],
          },
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: false,
          ...existingProviderConfig?.models?.[SKETCHI_AUTH_MODEL_ID],
        },
      },
    },
  };
}
