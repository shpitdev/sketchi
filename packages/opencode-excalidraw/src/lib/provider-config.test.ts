import { describe, expect, test } from "bun:test";

import { applySketchiAuthProviderConfig } from "./provider-config";

describe("applySketchiAuthProviderConfig", () => {
  test("adds a placeholder provider for saved Sketchi OAuth credentials", () => {
    const config = {};

    applySketchiAuthProviderConfig(config);

    expect(config.provider?.sketchi?.id).toBe("sketchi");
    expect(config.provider?.sketchi?.models?.auth?.id).toBe("auth");
    expect(config.provider?.sketchi?.models?.auth?.status).toBe("deprecated");
  });

  test("preserves user Sketchi provider overrides", () => {
    const config = {
      provider: {
        sketchi: {
          name: "Local Sketchi",
          api: "http://127.0.0.1:43123",
          models: {
            local: {
              id: "local",
              name: "Local model",
              limit: { context: 10, output: 10 },
              cost: { input: 0, output: 0 },
            },
          },
        },
      },
    };

    applySketchiAuthProviderConfig(config);

    expect(config.provider.sketchi.name).toBe("Local Sketchi");
    expect(config.provider.sketchi.api).toBe("http://127.0.0.1:43123");
    expect(config.provider.sketchi.models.local.id).toBe("local");
    expect(config.provider.sketchi.models.auth.id).toBe("auth");
  });
});
