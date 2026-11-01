import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@sketchi/ui/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@sketchi/ui/components/dialog";
import { formatCollectionLabel } from "@sketchi/icon-catalog";
import { formatForDisplay, type Hotkey } from "@tanstack/react-hotkeys";
import { Check } from "lucide-react";
import { useRef } from "react";

/**
 * Something the palette can run. The library builds one list of these and
 * registers the same entries with `useHotkeys`, so a command's name and key
 * are defined once.
 */
export interface IconCommand {
	readonly hotkey?: Hotkey;
	readonly id: string;
	readonly name: string;
	readonly run: () => void;
	/**
	 * The command moves focus itself (for example into the search field), so
	 * closing the palette must not hand focus back to where it was.
	 */
	readonly takesFocus?: boolean;
}

export interface PaletteLink {
	readonly external?: boolean;
	readonly href: string;
	readonly name: string;
}

export function CommandPalette({
	collections,
	commands,
	links,
	onClearCollections,
	onNavigate,
	onOpenChange,
	onToggleCollection,
	open,
	options,
}: {
	collections: ReadonlySet<string>;
	commands: readonly IconCommand[];
	links: readonly PaletteLink[];
	onClearCollections: () => void;
	onNavigate: (link: PaletteLink) => void;
	onOpenChange: (open: boolean) => void;
	onToggleCollection: (collection: string) => void;
	open: boolean;
	options: readonly (readonly [string, number])[];
}) {
	// The palette opens from Mod+K or a header button, never a DialogTrigger, so
	// Radix has no trigger to hand focus back to. It records whatever had focus
	// as it opens and puts focus back there on close, unless the chosen command
	// moves focus itself (Search).
	const opener = useRef<HTMLElement | null>(null);
	const pending = useRef<IconCommand["run"] | null>(null);
	const pendingTakesFocus = useRef(false);

	function choose(run: () => void, takesFocus = false) {
		pending.current = run;
		pendingTakesFocus.current = takesFocus;
		onOpenChange(false);
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="icons-palette"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					const run = pending.current;
					const takesFocus = pendingTakesFocus.current;
					const returnTo = opener.current;
					pending.current = null;
					pendingTakesFocus.current = false;
					opener.current = null;
					if (!takesFocus && returnTo?.isConnected) returnTo.focus();
					run?.();
				}}
				onOpenAutoFocus={() => {
					// Still the element focused before the palette opened.
					opener.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				showCloseButton={false}
			>
				<DialogTitle className="sr-only">Commands</DialogTitle>
				<DialogDescription className="sr-only">
					Run an action, filter by collection, or open a link.
				</DialogDescription>
				<Command className="icons-palette__command" loop>
					<CommandInput placeholder="Type a command or collection" />
					<CommandList className="icons-palette__list">
						<CommandEmpty>No matching command.</CommandEmpty>
						<CommandGroup heading="Actions">
							{commands.map((command) => (
								<CommandItem
									key={command.id}
									onSelect={() => choose(command.run, command.takesFocus)}
									value={command.name}
								>
									{command.name}
									{command.hotkey ? (
										<CommandShortcut>{formatForDisplay(command.hotkey)}</CommandShortcut>
									) : null}
								</CommandItem>
							))}
						</CommandGroup>
						<CommandGroup heading="Collections">
							{collections.size ? (
								<CommandItem onSelect={() => choose(onClearCollections)} value="All collections">
									All collections
								</CommandItem>
							) : null}
							{options.map(([name, count]) => {
								const label = formatCollectionLabel(name);
								const checked = collections.has(name);
								return (
									<CommandItem
										key={name}
										keywords={[name]}
										onSelect={() => choose(() => onToggleCollection(name))}
										value={`collection ${label}`}
									>
										<Check
											aria-hidden="true"
											className="icons-palette__check"
											data-checked={checked}
										/>
										{label}
										{checked ? <span className="sr-only">, active filter</span> : null}
										<CommandShortcut>{count.toLocaleString()}</CommandShortcut>
									</CommandItem>
								);
							})}
						</CommandGroup>
						<CommandGroup heading="Links">
							{links.map((link) => (
								<CommandItem
									key={link.href}
									onSelect={() => choose(() => onNavigate(link))}
									value={link.name}
								>
									{link.name}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
					<p className="icons-palette__keys">
						<span className="icons-palette__keys-label">In the icon grid</span>
						<span>
							<kbd>↑</kbd>
							<kbd>↓</kbd>
							<kbd>←</kbd>
							<kbd>→</kbd> move
						</span>
						<span>
							<kbd>Enter</kbd> copy SVG
						</span>
						<span>
							<kbd>Esc</kbd> clear search
						</span>
					</p>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
