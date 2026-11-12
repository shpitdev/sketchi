import type { ComponentProps } from "react";

/**
 * The Icons link's glyph: a circle, a square and two triangles drawn once
 * with Rough.js (roughness 0.3, one stroke, fixed seeds), so it reads as
 * hand-drawn yet sits evenly beside the header's line icons. It takes the
 * link's color and size.
 */
export function IconsGlyph(props: ComponentProps<"svg">) {
	return (
		<svg
			aria-hidden="true"
			data-slot="icons-glyph"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M7.12 2.94 C7.98 2.89, 9.15 3.53, 9.84 4.13 C10.53 4.73, 11.14 5.59, 11.26 6.56 C11.38 7.53, 11.04 9.11, 10.55 9.94 C10.06 10.77, 9.23 11.25, 8.32 11.54 C7.42 11.83, 6.04 11.98, 5.12 11.66 C4.2 11.34, 3.25 10.43, 2.82 9.63 C2.4 8.83, 2.31 7.74, 2.55 6.84 C2.79 5.94, 3.51 4.89, 4.28 4.23 C5.05 3.57, 6.71 3.02, 7.17 2.88 C7.63 2.73, 7 3.22, 7.03 3.35" />
			<path d="M13.5 13.5 C14.86 13.36, 16.91 13.52, 21.5 13.5 M21.5 13.5 C21.35 16.05, 21.6 18.13, 21.5 21.5 M21.5 21.5 C19.46 21.63, 17.5 21.47, 13.5 21.5 M13.5 21.5 C13.4 19.54, 13.47 17.83, 13.5 13.5" />
			<path d="M7 13.5 C8 14.91, 8.68 16.81, 11 21.5 M11 21.5 C7.9 21.34, 4.61 21.68, 3 21.5 M3 21.5 C4.79 18.66, 6.26 15.21, 7 13.5" />
			<path d="M13.8 10 C14.58 8.7, 15.09 7.42, 17.5 3 M17.5 3 C19.06 5.54, 20.36 8.08, 21.2 10 M21.2 10 C18.44 10.1, 15.47 9.8, 13.8 10" />
		</svg>
	);
}
