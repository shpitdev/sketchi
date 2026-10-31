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
 * The third way in. The playground and the agent route both get a full section
 * on this page; the terminal is a peer of both, so it gets one too — the
 * install command is the section, copy-pasteable, not a link to go find it.
 */
export function CliBand({ npmUrl = CLI_NPM_URL }: CliBandProps) {
	return (
		<section className="sk-section" id="cli">
			<div className="sk-shell cli-band__inner">
				<div>
					<h2 className="sk-section__title cli-band__title">CLI</h2>
					<p className="cli-band__lead">
						No account or API key. Every command takes <code>--output json</code>.
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

				<div className="cli-band__terminal">
					<div className="cli-band__bar" aria-hidden="true">
						<span className="cli-band__dots">
							<i />
							<i />
							<i />
						</span>
						<span className="cli-band__shell">zsh</span>
					</div>

					<div className="cli-band__body">
						<CommandBlock label="npm install command" value={CLI_NPM_INSTALL_COMMAND} />
						<div className="cli-band__example">
							<CommandBlock label="example command" value={CLI_EXAMPLE_COMMAND} />
						</div>
						<p className="cli-band__req">Requires {CLI_NODE_REQUIREMENT}.</p>
					</div>
				</div>
			</div>
		</section>
	);
}
