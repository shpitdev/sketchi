import { Result } from "effect";
import { parseMindmap } from "./document.js";
export const mindmapFixture = parseMindmap({
	id: "public-mindmap-capability",
	title: "Public mindmap generation",
	root: {
		label: "Public mindmaps",
		children: [
			{
				label: "Semantic input",
				children: [{ label: "Nested topics" }, { label: "Stable ordering" }],
			},
			{ label: "Artifact output", children: [{ label: "Scene" }, { label: "Excalidraw" }] },
		],
	},
}).pipe(Result.getOrThrow);
