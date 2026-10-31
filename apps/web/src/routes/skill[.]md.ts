import { createFileRoute } from "@tanstack/react-router";

import { PORTABLE_SKILL_SOURCE_URL } from "../lib/portable-skill";

// Temporary, so the skill's home can move without breaking pasted commands.
const redirectToSkill = () => Response.redirect(PORTABLE_SKILL_SOURCE_URL, 302);

export const Route = createFileRoute("/skill.md")({
	server: {
		handlers: {
			GET: redirectToSkill,
			HEAD: redirectToSkill,
		},
	},
});
