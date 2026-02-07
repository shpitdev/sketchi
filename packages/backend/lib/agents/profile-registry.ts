import { generalProfile } from "./profiles/general";
import type { PromptAgentProfile } from "./types";

/**
 * Registry of available prompt agent profiles.
 * Maps profile IDs to their configurations.
 */
const profiles: Map<string, PromptAgentProfile> = new Map([
  ["general", generalProfile],
]);

/**
 * Retrieve a prompt agent profile by ID.
 * Falls back to 'general' profile if the requested ID is not found.
 */
export function getProfile(id: string): PromptAgentProfile {
  const profile = profiles.get(id);
  if (!profile) {
    console.warn(`Profile '${id}' not found, falling back to 'general'`);
    const generalFallback = profiles.get("general");
    if (!generalFallback) {
      throw new Error("General profile not found in registry");
    }
    return generalFallback;
  }
  return profile;
}

/**
 * List all available profile IDs.
 */
export function listProfiles(): string[] {
  return Array.from(profiles.keys());
}
