import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  getVercelPreviewOrigin,
  upsertAudInTemplateContent,
} from "./configure-workos-jwt-template.mjs";

const originalVercelUrl = process.env.VERCEL_URL;

afterEach(() => {
  process.env.VERCEL_URL = originalVercelUrl;
});

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

describe("getVercelPreviewOrigin", () => {
  it("returns null without a Vercel URL", () => {
    process.env.VERCEL_URL = "";
    assert.equal(getVercelPreviewOrigin(), null);
  });

  it("normalizes Vercel hostnames to HTTPS origins", () => {
    process.env.VERCEL_URL = "sketchi-preview.vercel.app";
    assert.equal(
      getVercelPreviewOrigin(),
      "https://sketchi-preview.vercel.app"
    );
  });

  it("preserves fully qualified preview origins", () => {
    process.env.VERCEL_URL = "https://sketchi-preview.vercel.app/some-path";
    assert.equal(
      getVercelPreviewOrigin(),
      "https://sketchi-preview.vercel.app"
    );
  });
});
