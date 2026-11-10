import type { SketchiIcon } from "@sketchi/icon-catalog";

export interface IconMarkProps {
	readonly alt?: string;
	readonly icon: Pick<SketchiIcon, "onDark" | "onLight" | "svgPath">;
	readonly lazy?: boolean;
	readonly surface: "dark" | "light";
}

/**
 * A catalog mark on a light or dark surface. A neutral mark that would vanish
 * there is inverted; a multicolor mark is never recolored and sits on a
 * neutral plate instead.
 */
export function IconMark({ alt = "", icon, lazy = false, surface }: IconMarkProps) {
	const treatment = surface === "dark" ? icon.onDark : icon.onLight;
	return (
		<span className="icon-mark" data-surface={surface} data-treatment={treatment}>
			<img alt={alt} loading={lazy ? "lazy" : undefined} src={icon.svgPath} />
		</span>
	);
}
