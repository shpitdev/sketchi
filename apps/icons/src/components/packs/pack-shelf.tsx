import { ALL_ICONS_PACK_ID, packPagePath, type PackSummary } from "../../lib/packs.js";
import type { PreviewMode } from "../preview-toggle/index.js";
import { RecipePreview } from "../recipe-preview/index.js";
import { PackActions } from "./pack-actions.js";

export function iconCount(count: number): string {
	return `${count.toLocaleString("en-US")} ${count === 1 ? "icon" : "icons"}`;
}

/** The packs, each a strip of its own drawings, its size, and its two actions. */
export function PackShelf({
	origin,
	packs,
	previewMode,
}: {
	readonly origin: string;
	readonly packs: readonly PackSummary[];
	readonly previewMode: PreviewMode;
}) {
	if (!packs.length) return null;
	return (
		<section aria-labelledby="pack-shelf-title" className="pack-shelf">
			<h2 className="pack-shelf__title" id="pack-shelf-title">
				Excalidraw libraries
			</h2>
			<ul className="pack-shelf__list">
				{packs.map((pack) => (
					<li
						className="pack-card"
						data-whole-catalog={pack.id === ALL_ICONS_PACK_ID ? "true" : undefined}
						key={pack.id}
					>
						<span aria-hidden="true" className="pack-card__strip" data-preview={previewMode}>
							{pack.preview.map((icon) => (
								<RecipePreview
									className="pack-card__icon"
									key={icon.slug}
									previewMode={previewMode}
									recipe={icon.recipe}
								/>
							))}
						</span>
						<span className="pack-card__head">
							<a className="pack-card__name" href={packPagePath(pack.id)} id={`pack-${pack.id}`}>
								{pack.name}
							</a>
							<span className="pack-card__count">{iconCount(pack.count)}</span>
						</span>
						<PackActions describedBy={`pack-${pack.id}`} origin={origin} pack={pack} />
					</li>
				))}
			</ul>
		</section>
	);
}
