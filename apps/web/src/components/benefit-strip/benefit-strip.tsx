import type { LucideIcon } from "lucide-react";
import { FilePenLine, LockOpen, SquareTerminal } from "lucide-react";
import type { CSSProperties } from "react";

interface Benefit {
	icon: LucideIcon;
	title: string;
	detail: string;
}

// Each line is checked against the product: Studio and the CLI download a
// .excalidraw file, Codex and Claude Code install a plugin while other agents
// use the skill and MCP server, and neither the CLI nor the MCP endpoint asks
// for an account, key, or payment.
const benefits: readonly Benefit[] = [
	{
		icon: FilePenLine,
		title: "Native Excalidraw files",
		detail: "Download a .excalidraw file and keep editing every shape.",
	},
	{
		icon: SquareTerminal,
		title: "Your agent or CLI",
		detail: "Ask your coding agent, or run sketchi in a terminal.",
	},
	{
		icon: LockOpen,
		title: "Free, no account required",
		detail: "Sketchi needs no sign-up, API key, or payment.",
	},
];

/** Three reasons to use Sketchi, in one compact row under the hero. */
export function BenefitStrip() {
	return (
		<section aria-label="Why Sketchi" className="benefit-strip">
			<ul className="sk-shell benefit-strip__list">
				{benefits.map(({ icon: Icon, title, detail }, index) => (
					<li className="benefit sk-rise" key={title} style={{ "--i": index + 2 } as CSSProperties}>
						<span aria-hidden="true" className="benefit__icon">
							<Icon />
						</span>
						<span className="benefit__text">
							<strong className="benefit__title">{title}</strong>
							<span className="benefit__detail">{detail}</span>
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
