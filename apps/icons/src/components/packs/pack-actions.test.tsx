import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PackActions } from "./pack-actions";

const INSTALL_URL =
	"https://excalidraw.com/?addLibrary=https%3A%2F%2Fraw.githubusercontent.com%2Fexcalidraw%2Fexcalidraw-libraries%2Fjane-palantir-1%2Flibraries%2Fjane%2Fpalantir.excalidrawlib%3Fraw%3Dtrue";

describe("PackActions", () => {
	it("adds a submitted pack to Excalidraw's library in a new tab, and does not offer it again", () => {
		render(
			<PackActions
				describedBy="pack-palantir"
				excalidraw={{ installUrl: INSTALL_URL, publishable: false }}
				onPublish={() => undefined}
				pack={{ id: "palantir" }}
			/>,
		);
		const add = screen.getByRole("link", { name: "Add to Excalidraw" });
		expect(add.getAttribute("href")).toBe(INSTALL_URL);
		expect(add.getAttribute("target")).toBe("_blank");
		expect(add.getAttribute("aria-describedby")).toBe("pack-palantir");
		expect(screen.queryByRole("button", { name: "Publish to Excalidraw" })).toBeNull();
	});

	it("offers to publish a pack whose current version is open", () => {
		const onPublish = vi.fn();
		render(
			<PackActions
				excalidraw={{ publishable: true }}
				onPublish={onPublish}
				pack={{ id: "data" }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Publish to Excalidraw" }));
		expect(onPublish).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("link", { name: "Add to Excalidraw" })).toBeNull();
	});

	it("only downloads a pack with neither", () => {
		render(<PackActions pack={{ id: "cloud" }} />);
		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Download"]);
		expect(screen.queryByRole("button")).toBeNull();
	});
});
