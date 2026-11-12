import { Button } from "@sketchi/ui/components/button";

import { BrandIcon } from "../brand-icon/index.js";
import { CommandBlock } from "../command-block/index.js";
import {
	CLI_EXAMPLE_COMMAND,
	CLI_NODE_REQUIREMENT,
	CLI_NPM_INSTALL_COMMAND,
	CLI_NPM_URL,
} from "../../lib/cli-package";

export interface CliBandProps {
	/** Link to the published npm package. */
	npmUrl?: string;
}

/**
 * The terminal is a peer of the playground and the agents, so the install
 * command is the section, ready to copy, not a link to go find it.
 */
export function CliBand({ npmUrl = CLI_NPM_URL }: CliBandProps) {
	return (
		<section className="sk-section" id="cli">
			<div className="sk-shell cli-band__inner">
				<div>
					<h2 className="sk-section__title cli-band__title">CLI</h2>
					<p className="cli-band__lead">
						<code>sketchi generate</code> writes a PNG and keeps the diagram&rsquo;s .excalidraw
						file, so you can revise or export it later. Every command takes{" "}
						<code>--output json</code>.
					</p>

					<div className="cli-band__links">
						<Button asChild size="xl" variant="outline">
							<a className="cli-band__npm" href={npmUrl}>
								<BrandIcon label="npm" size={18} src="/brand/npm.svg" />
								View on npm
							</a>
						</Button>
					</div>
				</div>

				<div className="cli-band__commands">
					<CommandBlock label="npm install command" value={CLI_NPM_INSTALL_COMMAND} />
					<div className="cli-band__example">
						<CommandBlock label="example command" value={CLI_EXAMPLE_COMMAND} />
					</div>
					<p className="cli-band__req">Requires {CLI_NODE_REQUIREMENT}.</p>
				</div>
			</div>
		</section>
	);
}
