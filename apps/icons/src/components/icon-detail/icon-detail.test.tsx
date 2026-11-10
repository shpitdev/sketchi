import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SketchiIcon } from "@sketchi/icon-catalog";
import { IconDetail } from "./icon-detail";

const icon: SketchiIcon = {
	aliases: [],
	bytes: 1802,
	collection: "ai-apps-agents",
	colorMode: "multicolor",
	keywords: ["ai"],
	name: "Codex",
	slug: "codex",
	svgPath: "/output/upload-ready/svg/ai-apps-agents/codex.svg",
	viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
};

const drawing: IconRecipe = {
	parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, fill: "#10a37f" }],
};

describe("IconDetail", () => {
	it("shows the hand-drawn version beside the SVG and copies it for Excalidraw", () => {
		const onAction = vi.fn();
		render(
			<IconDetail drawing={drawing} icon={icon} onAction={onAction} permanentUrl="https://x" />,
		);

		expect(screen.getByRole("img", { name: "Codex hand-drawn" })).toBeTruthy();
		expect(screen.getByRole("img", { name: "Codex SVG" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy for Excalidraw" }));
		expect(onAction).toHaveBeenCalledWith("copy-excalidraw", icon);
	});

	it("offers no Excalidraw copy for a mark without a drawing", () => {
		render(<IconDetail icon={icon} permanentUrl="https://x" />);

		expect(screen.queryByRole("button", { name: "Copy for Excalidraw" })).toBeNull();
		expect(screen.getByRole("img", { name: "Codex preview" })).toBeTruthy();
	});
});
