import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@sketchi/ui/components/dropdown-menu";
import { formatCollectionLabel } from "@sketchi/icon-catalog";
import { ChevronDown } from "lucide-react";

export function collectionSummary(collections: ReadonlySet<string>): string {
	const [only] = collections;
	if (!only) return "All collections";
	if (collections.size === 1) return formatCollectionLabel(only);
	return `${collections.size} collections`;
}

/**
 * A checkbox menu over every collection. Ticking several shows icons from any
 * of them; ticking none shows the whole library. The menu stays open while
 * ticking so several collections can be picked in one visit.
 */
export function CollectionFilter({
	collections,
	onClear,
	onOpenChange,
	onToggle,
	options,
}: {
	collections: ReadonlySet<string>;
	onClear: () => void;
	onOpenChange: (open: boolean) => void;
	onToggle: (collection: string) => void;
	options: readonly (readonly [string, number])[];
}) {
	const summary = collectionSummary(collections);
	return (
		<DropdownMenu modal={false} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger
				aria-label={`Collections: ${summary}`}
				className="collection-filter"
				data-filtered={collections.size ? "true" : "false"}
			>
				<span className="collection-filter__summary">{summary}</span>
				<ChevronDown aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="collection-filter__menu">
				<DropdownMenuItem disabled={!collections.size} onSelect={onClear}>
					All collections
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{options.map(([name, count]) => (
					<DropdownMenuCheckboxItem
						checked={collections.has(name)}
						key={name}
						onCheckedChange={() => onToggle(name)}
						onSelect={(event) => event.preventDefault()}
					>
						<span className="collection-filter__name">{formatCollectionLabel(name)}</span>
						<span className="collection-filter__count">{count.toLocaleString()}</span>
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
