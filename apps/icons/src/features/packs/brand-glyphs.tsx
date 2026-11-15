import type { ComponentProps } from "react";

/*
 * GitHub's and Excalidraw's marks for the buttons that open a pack's pull
 * request and add it to Excalidraw, drawn once with Rough.js (roughness 0.3,
 * one stroke, fixed seeds) so they read as hand-drawn beside the site's line
 * icons. Each takes its button's color and size.
 */

function Glyph({ children, ...props }: ComponentProps<"svg">) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
			{...props}
		>
			{children}
		</svg>
	);
}

/** GitHub's Octocat, in outline. */
export function GitHubGlyph(props: ComponentProps<"svg">) {
	return (
		<Glyph data-slot="github-glyph" {...props}>
			<path d="M15 22 C14.87 21.12, 15.1 20.4, 15 18 C15.16 16.71, 14.31 15.11, 14 14.5 C17.29 14.74, 19.41 12.17, 20 9 C19.99 7.19, 19.54 6.88, 19 5.5 C19.1 4.31, 18.84 3.28, 19 2 C19.46 1.75, 17.62 1.92, 16 3.5 C13.26 3.18, 10.79 3.15, 8 3.5 C6.52 2.57, 4.87 2.12, 5 3.5 C4.61 4.7, 4.94 5.66, 5 7 C4.51 8.1, 4.3 8.77, 4 9 C4.27 12.55, 6.89 15.05, 10 14.5 C9.42 14.54, 9.08 15.14, 9.15 16.15 C9.04 16.4, 9.18 17.73, 9 18 C8.92 19.04, 8.92 19.83, 9 22" />
			<path d="M9 18 C3.89 20.52, 4.13 16.42, 2 16" />
		</Glyph>
	);
}

/** Excalidraw's pen between its two filled corners. */
export function ExcalidrawGlyph(props: ComponentProps<"svg">) {
	return (
		<Glyph data-slot="excalidraw-glyph" {...props}>
			<path d="M18.5 2.5 C19.03 2.5, 19.65 2.59, 21.5 2.8 C21.37 3.57, 21.02 4.35, 20.6 6.6 C16.54 11.01, 12.38 15.29, 6.4 20.6 C5.24 20.96, 3.84 21.21, 2.6 21.6 C2.69 20.59, 2.65 19.54, 2.9 17.8 C7.86 12.94, 11.86 8.82, 17 3.8 C17.38 3.57, 17.64 3.2, 18.5 2.5 Z" />
			<path
				d="M2.5 2.5 C3.74 2.92, 4.78 3.36, 8.6 4.2 C8.96 5.14, 9.24 6.08, 9.4 6.8 C8.42 7.67, 7.36 8.36, 6.8 9 C5.85 8.53, 5.04 8.19, 3.7 7.4 C3.36 6.35, 3.26 5.3, 2.5 2.5 Z"
				fill="currentColor"
			/>
			<path
				d="M15.2 13.2 C16.09 14.02, 17.14 14.58, 19.8 17 C19.77 17.99, 19.79 18.77, 19.8 20.6 C18.18 20.71, 16.79 20.71, 15 20.6 C14.32 19.06, 13.65 17.41, 13.2 16.2 C13.73 15.44, 14.12 14.76, 15.2 13.2 Z"
				fill="currentColor"
			/>
		</Glyph>
	);
}
