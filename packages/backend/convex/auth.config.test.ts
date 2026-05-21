import { beforeAll, describe, expect, test } from "vitest";

let buildWorkOsClientIds: (primaryClientId: string) => string[];

beforeAll(async () => {
  process.env.WORKOS_CLIENT_ID = "client_current";
  ({ buildWorkOsClientIds } = await import("./auth.config"));
});

describe("buildWorkOsClientIds", () => {
  test("keeps the primary client id first", () => {
    expect(buildWorkOsClientIds("client_current")).toEqual(["client_current"]);
  });

  test("accepts current production tokens when Convex still has the preview client", () => {
    expect(buildWorkOsClientIds("client_01KFPXKM905BYDQY5Q7BFJN409")).toEqual([
      "client_01KFPXKM905BYDQY5Q7BFJN409",
      "client_01KG0NPZN3AWXNTRHC58VAPVW2",
    ]);
  });

  test("accepts preview and production tokens when Convex still has the legacy preview client", () => {
    expect(buildWorkOsClientIds("client_01KG0NZ3QX0AJQE87CKZC74YXQ")).toEqual([
      "client_01KG0NZ3QX0AJQE87CKZC74YXQ",
      "client_01KFPXKM905BYDQY5Q7BFJN409",
      "client_01KG0NPZN3AWXNTRHC58VAPVW2",
    ]);
  });
});
