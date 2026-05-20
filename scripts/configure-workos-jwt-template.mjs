#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const WORKOS_API_BASE_URL = "https://api.workos.com";
const JWT_TEMPLATE_PATH = "/user_management/jwt_template";
const REDIRECT_URIS_PATH = "/user_management/redirect_uris";
const CORS_ORIGINS_PATH = "/user_management/cors_origins";
const ALREADY_CONFIGURED_PATTERN = /\b(already|duplicate|exists|taken)\b/i;
const WHITESPACE_PATTERN = /\s/;

const dryRun = process.argv.includes("--dry-run");

async function requestWorkOs(path, options = {}) {
  const apiKey = process.env.WORKOS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "WORKOS_API_KEY must be set to configure WorkOS JWT template"
    );
  }

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

function isAlreadyConfiguredError(error) {
  return (
    error instanceof Error && ALREADY_CONFIGURED_PATTERN.test(error.message)
  );
}

async function createIfMissing(path, body, label) {
  try {
    await requestWorkOs(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(`${label} added`);
  } catch (error) {
    if (isAlreadyConfiguredError(error)) {
      console.log(`${label} already configured`);
      return;
    }
    throw error;
  }
}

export function getVercelPreviewOrigin() {
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (!vercelUrl) {
    return null;
  }

  const url = vercelUrl.startsWith("http")
    ? new URL(vercelUrl)
    : new URL(`https://${vercelUrl}`);
  return url.origin;
}

async function configurePreviewAuthKitUrls() {
  const previewOrigin = getVercelPreviewOrigin();
  if (!previewOrigin) {
    return;
  }

  await createIfMissing(
    REDIRECT_URIS_PATH,
    { uri: `${previewOrigin}/callback` },
    `AuthKit redirect URI ${previewOrigin}/callback`
  );
  await createIfMissing(
    CORS_ORIGINS_PATH,
    { origin: previewOrigin },
    `AuthKit CORS origin ${previewOrigin}`
  );
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function skipWhitespace(content, index) {
  let currentIndex = index;
  while (
    currentIndex < content.length &&
    WHITESPACE_PATTERN.test(content[currentIndex])
  ) {
    currentIndex += 1;
  }
  return currentIndex;
}

function readStringToken(content, index) {
  if (content[index] !== '"') {
    return null;
  }

  let value = "";
  let currentIndex = index + 1;
  while (currentIndex < content.length) {
    const character = content[currentIndex];
    if (character === "\\") {
      const nextCharacter = content[currentIndex + 1];
      if (nextCharacter === undefined) {
        return null;
      }
      value += character + nextCharacter;
      currentIndex += 2;
      continue;
    }
    if (character === '"') {
      try {
        return {
          end: currentIndex + 1,
          value: JSON.parse(content.slice(index, currentIndex + 1)),
        };
      } catch {
        return { end: currentIndex + 1, value };
      }
    }
    value += character;
    currentIndex += 1;
  }

  return null;
}

function skipTemplateExpression(content, index) {
  if (!(content[index] === "{" && content[index + 1] === "{")) {
    return index;
  }

  const closeIndex = content.indexOf("}}", index + 2);
  return closeIndex === -1 ? content.length : closeIndex + 2;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Template strings need a tiny scanner so unquoted WorkOS expressions are preserved.
function findObjectBounds(content) {
  const start = skipWhitespace(content, 0);
  if (content[start] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{" && content[index + 1] === "{") {
      index = skipTemplateExpression(content, index) - 1;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { end: index, start };
      }
    }
  }

  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This only scans a single top-level JWT template property while respecting template expressions.
function findTopLevelAudValueRange(content, bounds) {
  let depth = 1;
  let index = bounds.start + 1;

  while (index < bounds.end) {
    const character = content[index];

    if (character === '"') {
      const key = readStringToken(content, index);
      if (!key) {
        return null;
      }

      const colonIndex = skipWhitespace(content, key.end);
      if (depth === 1 && key.value === "aud" && content[colonIndex] === ":") {
        const valueStart = skipWhitespace(content, colonIndex + 1);
        let valueEnd = valueStart;
        let valueDepth = 0;
        let inValueString = false;
        let escaped = false;

        while (valueEnd < bounds.end) {
          const valueCharacter = content[valueEnd];

          if (inValueString) {
            if (escaped) {
              escaped = false;
            } else if (valueCharacter === "\\") {
              escaped = true;
            } else if (valueCharacter === '"') {
              inValueString = false;
            }
            valueEnd += 1;
            continue;
          }

          if (valueCharacter === '"') {
            inValueString = true;
            valueEnd += 1;
            continue;
          }

          if (valueCharacter === "{" && content[valueEnd + 1] === "{") {
            valueEnd = skipTemplateExpression(content, valueEnd);
            continue;
          }

          if (valueCharacter === "{" || valueCharacter === "[") {
            valueDepth += 1;
          } else if (valueCharacter === "}" || valueCharacter === "]") {
            if (valueDepth === 0) {
              break;
            }
            valueDepth -= 1;
          } else if (valueDepth === 0 && valueCharacter === ",") {
            break;
          }

          valueEnd += 1;
        }

        return {
          end: content.slice(0, valueEnd).trimEnd().length,
          start: valueStart,
        };
      }

      index = key.end;
      continue;
    }

    if (character === "{" && content[index + 1] === "{") {
      index = skipTemplateExpression(content, index);
      continue;
    }

    if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }

    index += 1;
  }

  return null;
}

export function upsertAudInTemplateContent(content, aud) {
  const audValue = JSON.stringify(aud);

  if (!(typeof content === "string" && content.trim().length > 0)) {
    return JSON.stringify({ aud });
  }

  try {
    const parsed = JSON.parse(content);
    if (!isObject(parsed)) {
      throw new Error(
        "Existing WorkOS JWT template content is not a JSON object"
      );
    }
    return JSON.stringify({
      ...parsed,
      aud,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      !error.message.includes("JSON") &&
      !error.message.includes("position")
    ) {
      throw error;
    }
  }

  const bounds = findObjectBounds(content);
  if (!bounds) {
    throw new Error("Existing WorkOS JWT template content is not an object");
  }

  const audRange = findTopLevelAudValueRange(content, bounds);
  if (audRange) {
    return `${content.slice(0, audRange.start)}${audValue}${content.slice(audRange.end)}`;
  }

  const beforeEnd = content.slice(0, bounds.end).trimEnd();
  const afterEnd = content.slice(bounds.end);
  const hasExistingProperties = content
    .slice(bounds.start + 1, bounds.end)
    .trim();
  const prefix = hasExistingProperties ? "," : "";
  return `${beforeEnd}${prefix}\n  "aud": ${audValue}\n${afterEnd}`;
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

    return content;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("WorkOS GET") &&
      (error.message.includes("404") ||
        error.message.includes("JWT template not found"))
    ) {
      return {};
    }
    throw error;
  }
}

export async function main() {
  const clientId = process.env.WORKOS_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      "WORKOS_CLIENT_ID must be set to configure WorkOS JWT template"
    );
  }

  const currentContent = dryRun ? "" : await readCurrentTemplate();
  const nextContent = upsertAudInTemplateContent(currentContent, clientId);

  if (currentContent === nextContent) {
    console.log(`WorkOS JWT template already has aud=${clientId}`);
    return;
  }

  if (dryRun) {
    console.log(nextContent);
    return;
  }

  await configurePreviewAuthKitUrls();

  await requestWorkOs(JWT_TEMPLATE_PATH, {
    method: "PUT",
    body: JSON.stringify({
      content: nextContent,
    }),
  });

  console.log(`Configured WorkOS JWT template aud=${clientId}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
