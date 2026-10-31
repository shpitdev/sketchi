import { Button } from "@sketchi/ui/components/button";

import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface CtaBandProps {
	/** Link to the no-signup playground. */
	playgroundHref?: string;
}

/** Closing call to action: a blank sketch sheet echoing the hero board. */
export function CtaBand({ playgroundHref = DEFAULT_WEB_SURFACE_URLS.playground }: CtaBandProps) {
	return (
		<section className="cta-band">
			<div className="sk-shell">
				<div className="cta-band__sheet">
					<span className="cta-band__caret" aria-hidden="true" />
					<h2 className="cta-band__title">Describe your first diagram.</h2>
					<p className="cta-band__lead">No sign-up.</p>
					<div className="cta-band__actions">
						<Button asChild size="xl" variant="brand">
							<a href={playgroundHref}>Open playground</a>
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}
