import { CopyButton } from "../copy-button/index.js";

export interface CommandBlockProps {
	/** Exactly what the copy button writes; shell commands must run as pasted. */
	value: string;
	/** What the block holds, for the copy button's accessible name. */
	label: string;
	/**
	 * `code` keeps every line as written and scrolls sideways when a line is
	 * too long, so a path or URL never breaks. `prose` is for chat prompts:
	 * it wraps between words.
	 */
	kind?: "code" | "prose";
}

/** A command or snippet on the dark code surface, with its copy button beside it. */
export function CommandBlock({ value, label, kind = "code" }: CommandBlockProps) {
	return (
		<div className="command-block" data-kind={kind}>
			{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region must be reachable from the keyboard. */}
			<pre aria-label={label} className="command-block__code" tabIndex={0}>
				<code>{value}</code>
			</pre>
			<CopyButton label={label} value={value} />
		</div>
	);
}
