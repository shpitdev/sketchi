import { SITE_URL } from "./site-meta";

/**
 * Short public URL for the portable Code Mode skill, so setup commands fit on
 * one line. `/skill.md` redirects to the source below; `curl -fsSL` follows it.
 */
export const PORTABLE_SKILL_URL = `${SITE_URL}/skill.md`;

/** The skill as committed on main. Agents that cannot use a plugin copy this file. */
export const PORTABLE_SKILL_SOURCE_URL =
	"https://raw.githubusercontent.com/shpitdev/sketchi/main/.agents/skills/sketchi-code-mode/SKILL.md";
