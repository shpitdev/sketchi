import { Button } from "@sketchi/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@sketchi/ui/components/tooltip";
import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

export interface CopyButtonProps {
	/** Text written to the clipboard on click. */
	value: string;
	/** What is being copied, for the accessible name (e.g. "install command"). */
	label?: string;
}

/**
 * Icon button that copies a command or snippet and confirms with a check.
 * It sits on the dark code surface beside the text, never on top of it.
 */
export function CopyButton({ value, label }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	// A reset that fires after unmount is a no-op, so the timer only needs
	// clearing when a new copy restarts it.
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			return;
		}
		setCopied(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setCopied(false), 1600);
	}

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						aria-label={copied ? "Copied" : label ? `Copy ${label}` : "Copy"}
						data-copied={copied ? "" : undefined}
						onClick={() => void copy()}
						size="icon-sm"
						type="button"
						variant="code"
					>
						{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
