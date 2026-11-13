import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PackActions } from "./pack-actions";

const INSTALL_URL =
	"https://excalidraw.com/?addLibrary=https%3A%2F%2Fraw.githubusercontent.com%2Fexcalidraw%2Fexcalidraw-libraries%2Fjane-palantir-1%2Flibraries%2Fjane%2Fpalantir.excalidrawlib%3Fraw%3Dtrue";

const PR_URL = "https://github.com/excalidraw/excalidraw-libraries/pull/3004";

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

	it("follows a submitted pack's pull request, with its state once GitHub has been read", () => {
		const pullRequest = { url: PR_URL, state: "merged" } as const;
		const { unmount } = render(
			<PackActions
				describedBy="pack-palantir"
				excalidraw={{ installUrl: INSTALL_URL, pullRequest, publishable: false }}
				pack={{ id: "palantir" }}
			/>,
		);
		// A card shows the marks with a short label: the names say the rest.
		const compact = screen.getByRole("link", { name: "Pull request, merged" });
		expect(compact.getAttribute("href")).toBe(PR_URL);
		expect(compact.getAttribute("target")).toBe("_blank");
		expect(compact.getAttribute("title")).toBe("Pull request, merged");
		expect(compact.getAttribute("aria-describedby")).toBe("pack-palantir");
		expect(screen.getByRole("link", { name: "Add to Excalidraw" }).textContent).toBe("Add");
		unmount();

		render(
			<PackActions
				excalidraw={{ pullRequest: { url: PR_URL }, publishable: false }}
				pack={{ id: "palantir" }}
				size="large"
			/>,
		);
		// Unread, the pull request shows no state.
		expect(screen.getByRole("link", { name: "Pull request" }).getAttribute("href")).toBe(PR_URL);
	});

	it("only downloads a pack with neither", () => {
		render(<PackActions pack={{ id: "cloud" }} />);
		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Download"]);
		expect(screen.queryByRole("button")).toBeNull();
	});
});
