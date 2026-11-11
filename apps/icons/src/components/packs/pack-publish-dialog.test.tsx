import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PackSummary } from "../../lib/packs";
import { PackShelf } from "./pack-shelf";

const PR = "https://github.com/excalidraw/excalidraw-libraries/pull/4242";
const INSTALL =
	"https://excalidraw.com/?addLibrary=https%3A%2F%2Fraw.githubusercontent.com%2Fexcalidraw%2Fexcalidraw-libraries%2Fjane-1%2Flibraries%2Fjane%2Fdata-and-backend-logos.excalidrawlib%3Fraw%3Dtrue";

const packs: PackSummary[] = [
	{ id: "data", name: "Data & backend", version: "0123456789abcdef", count: 67, preview: [] },
];

afterEach(() => {
	vi.unstubAllGlobals();
});

function openDialog() {
	render(
		<PackShelf excalidraw={{ data: { publishable: true } }} packs={packs} previewMode="light" />,
	);
	fireEvent.click(screen.getByRole("button", { name: "Publish to Excalidraw" }));
	return screen.getByRole("dialog", { name: "Publish to Excalidraw" });
}

describe("PackPublishDialog", () => {
	it("fills in the listing and sends only the author's fields", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ pullRequestUrl: PR, installUrl: INSTALL }, { status: 201 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const dialog = openDialog();
		expect(within(dialog).getByText(/Data and Backend Logos/u)).toBeTruthy();
		expect(within(dialog).getByText(/^Hand-drawn logos of databases/u)).toBeTruthy();
		expect(
			within(dialog)
				.getByRole("img", { name: "Data and Backend Logos preview" })
				.getAttribute("src"),
		).toBe("/packs/data.preview.jpg");
		const website = within(dialog).getByLabelText("Website (optional)") as HTMLInputElement;
		expect(website.value).toBe("https://icons.sketchi.app/packs/data");
		expect(within(dialog).queryByLabelText(/GitHub/u)).toBeNull();
		const name = within(dialog).getByLabelText("Your name") as HTMLInputElement;
		expect([name.required, name.maxLength]).toEqual([true, 60]);

		fireEvent.change(name, { target: { value: "Jane" } });
		fireEvent.change(within(dialog).getByLabelText("Twitter handle (optional)"), {
			target: { value: "jane" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

		expect(await within(dialog).findByRole("link", { name: "View pull request" })).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledWith("/api/packs/data/excalidraw", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				authorName: "Jane",
				twitterHandle: "jane",
				website: "https://icons.sketchi.app/packs/data",
			}),
		});
		fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		// The card now adds the pack to Excalidraw and no longer offers to publish it.
		expect(screen.getByRole("link", { name: "Add to Excalidraw" }).getAttribute("href")).toBe(
			INSTALL,
		);
		expect(screen.queryByRole("button", { name: "Publish to Excalidraw" })).toBeNull();
	});

	it("shows why a submission failed and keeps the form", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json(
					{
						error: {
							code: "already_submitted",
							message: "This version of the pack has already been sent to Excalidraw.",
						},
					},
					{ status: 409 },
				),
			),
		);
		const dialog = openDialog();
		fireEvent.change(within(dialog).getByLabelText("Your name"), { target: { value: "Jane" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
		expect((await within(dialog).findByRole("alert")).textContent).toBe(
			"This version of the pack has already been sent to Excalidraw.",
		);
		expect(within(dialog).getByRole("button", { name: "Publish" })).toBeTruthy();
	});
});
