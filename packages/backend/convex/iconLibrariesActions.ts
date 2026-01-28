import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const MAX_SVG_BYTES = 256 * 1024;

const invalidTagPattern = /<\s*(script|foreignobject)\b/i;
const externalRefPattern =
  /(?:xlink:href|href)\s*=\s*["']\s*(?:https?:|data:|\/\/)/i;
const externalUrlPattern = /url\(\s*["']?\s*(?:https?:|data:|\/\/)/i;

const FILE_EXTENSION_REGEX = /\.[^/.]+$/;
const FILE_STEM_CLEANUP_REGEX = /[^a-z0-9]+/g;
const FILE_STEM_TRIM_REGEX = /^-+|-+$/g;
const SVG_OPEN_TAG_REGEX = /<\s*svg[\s>]/i;
const SVG_CLOSE_TAG_REGEX = /<\s*\/\s*svg\s*>/i;

const hashText = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const sanitizeFileStem = (value: string) =>
  value
    .replace(FILE_EXTENSION_REGEX, "")
    .toLowerCase()
    .trim()
    .replace(FILE_STEM_CLEANUP_REGEX, "-")
    .replace(FILE_STEM_TRIM_REGEX, "")
    .slice(0, 80) || "icon";

const validateSvgText = (svgText: string) => {
  if (
    !(SVG_OPEN_TAG_REGEX.test(svgText) && SVG_CLOSE_TAG_REGEX.test(svgText))
  ) {
    throw new Error("Invalid SVG: missing <svg> root element.");
  }
  if (invalidTagPattern.test(svgText)) {
    throw new Error("Invalid SVG: disallowed tags detected.");
  }
  if (externalRefPattern.test(svgText) || externalUrlPattern.test(svgText)) {
    throw new Error("Invalid SVG: external references are not allowed.");
  }
};

export const addIcon: ReturnType<typeof action> = action({
  args: {
    libraryId: v.id("iconLibraries"),
    storageId: v.id("_storage"),
    originalName: v.string(),
  },
  handler: async (
    ctx,
    { libraryId, storageId, originalName }
  ): Promise<string> => {
    const file = await ctx.storage.get(storageId);
    if (!file) {
      throw new Error("Uploaded SVG not found.");
    }

    if (file.size > MAX_SVG_BYTES) {
      await ctx.storage.delete(storageId);
      throw new Error("SVG exceeds 256KB limit.");
    }

    const svgText = await file.text();
    try {
      validateSvgText(svgText);
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }

    const contentHash = (await hashText(svgText)).slice(0, 12);
    const fileStem = sanitizeFileStem(originalName);
    const fileName = `${libraryId}-${fileStem}-${contentHash}.svg`;

    return ctx.runMutation(internal.iconLibraries.addIconRecord, {
      libraryId,
      storageId,
      originalName,
      contentHash,
      fileName,
      byteSize: file.size,
    });
  },
});
