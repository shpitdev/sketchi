import { createFileRoute } from "@tanstack/react-router";

import { CLI_INSTALL_SCRIPT_SOURCE_URL } from "../lib/cli-package";

// Temporary, so the installer's home can move without breaking pasted commands.
const redirectToInstaller = () => Response.redirect(CLI_INSTALL_SCRIPT_SOURCE_URL, 302);

export const Route = createFileRoute("/install.sh")({
	server: {
		handlers: {
			GET: redirectToInstaller,
			HEAD: redirectToInstaller,
		},
	},
});
