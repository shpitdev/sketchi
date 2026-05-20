#!/usr/bin/env node

const WORKOS_API_BASE_URL = "https://api.workos.com";
const JWT_TEMPLATE_PATH = "/user_management/jwt_template";

const apiKey = process.env.WORKOS_API_KEY?.trim();
const clientId = process.env.WORKOS_CLIENT_ID?.trim();
const dryRun = process.argv.includes("--dry-run");

if (!apiKey) {
  throw new Error(
    "WORKOS_API_KEY must be set to configure WorkOS JWT template"
  );
}

if (!clientId) {
  throw new Error(
    "WORKOS_CLIENT_ID must be set to configure WorkOS JWT template"
  );
}

async function requestWorkOs(path, options = {}) {
  const response = await fetch(`${WORKOS_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? payload.message
        : text;
    throw new Error(
      `WorkOS ${options.method ?? "GET"} ${path} failed: ${message}`
    );
  }

  return payload;
}

async function readCurrentTemplate() {
  try {
    const payload = await requestWorkOs(JWT_TEMPLATE_PATH);
    const content =
      payload?.jwt_template &&
      typeof payload.jwt_template === "object" &&
      "content" in payload.jwt_template
        ? payload.jwt_template.content
        : undefined;

    if (!(typeof content === "string" && content.trim().length > 0)) {
      return {};
    }

    const parsed = JSON.parse(content);
    if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
      throw new Error(
        "Existing WorkOS JWT template content is not a JSON object"
      );
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("WorkOS GET") &&
      error.message.includes("404")
    ) {
      return {};
    }
    throw error;
  }
}

const currentTemplate = dryRun ? {} : await readCurrentTemplate();
const nextTemplate = {
  ...currentTemplate,
  aud: clientId,
};
const nextContent = JSON.stringify(nextTemplate);

if (currentTemplate.aud === clientId) {
  console.log(`WorkOS JWT template already has aud=${clientId}`);
  process.exit(0);
}

if (dryRun) {
  console.log(nextContent);
  process.exit(0);
}

await requestWorkOs(JWT_TEMPLATE_PATH, {
  method: "PUT",
  body: JSON.stringify({
    content: nextContent,
  }),
});

console.log(`Configured WorkOS JWT template aud=${clientId}`);
