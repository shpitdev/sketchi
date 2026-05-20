import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { upsertAudInTemplateContent } from "./configure-workos-jwt-template.mjs";

describe("upsertAudInTemplateContent", () => {
  it("creates a minimal template when no content exists", () => {
    assert.equal(
      upsertAudInTemplateContent("", "client_test"),
      '{"aud":"client_test"}'
    );
  });

  it("preserves JSON templates while setting aud", () => {
    assert.equal(
      upsertAudInTemplateContent(
        '{"urn:sketchi:role":"admin","aud":"old_client"}',
        "client_test"
      ),
      '{"urn:sketchi:role":"admin","aud":"client_test"}'
    );
  });

  it("adds aud to WorkOS template expressions that are not strict JSON", () => {
    assert.equal(
      upsertAudInTemplateContent(
        `{
  "urn:sketchi:email": {{ user.email }}
}`,
        "client_test"
      ),
      `{
  "urn:sketchi:email": {{ user.email }},
  "aud": "client_test"
}`
    );
  });

  it("updates an existing aud value in template text", () => {
    assert.equal(
      upsertAudInTemplateContent(
        `{
  "aud": {{ organization.metadata.audience }},
  "urn:sketchi:email": {{ user.email }}
}`,
        "client_test"
      ),
      `{
  "aud": "client_test",
  "urn:sketchi:email": {{ user.email }}
}`
    );
  });
});
