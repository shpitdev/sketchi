import { RegistryProvider } from "@effect/atom-react";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { ReactNode } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sketchi/diagram-ui", async (original) => ({
	...(await original<typeof import("@sketchi/diagram-ui")>()),
	ExcalidrawSceneCanvas: ({
		onChange,
		scene,
		title,
	}: {
		onChange?: (elements: readonly ExcalidrawElement[]) => void;
		scene: { readonly elements: readonly ExcalidrawElement[] };
		title: string;
	}) => (
		<section aria-label={title}>
			Editable canvas
			<button
				onClick={() => {
					onChange?.(
						scene.elements.map((element, index) =>
							index === 0
								? {
										...element,
										groupIds: ["workspace-edited"],
										strokeColor: "#ff006e",
										version: element.version + 1,
										x: element.x + 24,
									}
								: element,
						),
					);
				}}
				type="button"
			>
				Apply representative edit
			</button>
		</section>
	),
}));

import type { SvgHandoff } from "../../lib/svg-handoff";
import { svgHttpLayer } from "../../lib/svg-source-atom";
import { SvgIconWorkspace, type SvgIconWorkspaceProps } from "./svg-icon-workspace";

const handoff: SvgHandoff = {
	options: {
		colorProfile: { kind: "preserve" },
		fillStyle: "solid",
		roughness: 1,
	},
	sourceUrl:
		"https://pr-91-sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/testing/sample.svg",
};
const supportedSvg = '<svg viewBox="0 0 20 20"><path fill="#f00" d="M0 0H20V20H0Z"/></svg>';
const blockedSvg =
	'<svg viewBox="0 0 20 20"><filter id="f"><feGaussianBlur stdDeviation="2"/></filter><rect width="20" height="20" filter="url(#f)"/></svg>';

function renderWorkspace(
	fetch: typeof globalThis.fetch,
	props: SvgIconWorkspaceProps = { handoff },
) {
	return render(<SvgIconWorkspace {...props} />, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<RegistryProvider
				initialValues={[
					[
						svgHttpLayer,
						FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
					],
				]}
			>
				{children}
			</RegistryProvider>
		),
	});
}
const svgResponse = (body: BodyInit = supportedSvg, headers?: Record<string, string>) =>
	new Response(body, { headers: { "content-type": "image/svg+xml", ...headers } });
const nextHandoff = (name: string): SvgHandoff => ({
	...handoff,
	sourceUrl: handoff.sourceUrl.replace("sample", name),
});
const expectUnavailable = async (message: string) => {
	expect(await screen.findByText(message)).toBeTruthy();
	expect(screen.queryByText("Editable canvas")).toBeNull();
	expect(screen.getByRole("button", { name: "Download library" })).toHaveProperty("disabled", true);
};

describe("SvgIconWorkspace", () => {
	it("loads the trusted SVG and exports the current edited scene", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(svgResponse());
		const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:edited-library");
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined);
		renderWorkspace(fetchMock);
		expect(await screen.findByLabelText("sample.svg editable canvas")).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL(handoff.sourceUrl));
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			redirect: "error",
			signal: expect.any(AbortSignal),
		});
		expect(screen.getByText("Elements").parentElement?.textContent).toBe("Elements1");
		fireEvent.click(screen.getByRole("button", { name: "Apply representative edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Download library" }));
		const blob = createObjectUrl.mock.calls[0]?.[0];
		expect(blob).toBeInstanceOf(Blob);
		if (!(blob instanceof Blob)) throw new Error("Missing library download");
		const library = JSON.parse(await blob.text());
		expect(library.libraryItems[0].elements[0]).toMatchObject({
			groupIds: ["workspace-edited"],
			strokeColor: "#ff006e",
			x: 24,
		});
		expect(click).toHaveBeenCalledOnce();
	});

	it("uses initialSource without network and keeps blocked capability diagnostics out of the editor", () => {
		const fetchMock = vi.fn<typeof fetch>();
		const fixture = renderWorkspace(fetchMock, { handoff, initialSource: blockedSvg });
		expect(screen.getByText("Native import unavailable")).toBeTruthy();
		expect(screen.queryByText("Editable canvas")).toBeNull();
		expect(screen.getByLabelText("Import diagnostics")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Download library" })).toHaveProperty(
			"disabled",
			true,
		);
		fixture.rerender(<SvgIconWorkspace handoff={handoff} initialSource={supportedSvg} />);
		expect(screen.getByLabelText("sample.svg editable canvas")).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects invalid responses without partial scenes, then recovers on a new handoff without automatic retries", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(supportedSvg, { headers: { "content-type": "text/html" } }),
			)
			.mockResolvedValueOnce(svgResponse(supportedSvg, { "content-length": "1000001" }))
			.mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValueOnce(svgResponse());
		const { rerender } = renderWorkspace(fetchMock);
		for (const [index, message] of [
			"Icon source did not return an SVG content type.",
			"Icon SVG exceeds the 1 MB workspace import limit.",
			"Icon SVG returned HTTP 403.",
			"The icon SVG could not be loaded.",
		].entries()) {
			await expectUnavailable(message);
			fireEvent(window, new Event("focus"));
			fireEvent(window, new Event("online"));
			expect(fetchMock).toHaveBeenCalledTimes(index + 1);
			rerender(<SvgIconWorkspace handoff={nextHandoff(`response-${index}`)} />);
		}
		expect(await screen.findByLabelText("response-3.svg editable canvas")).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledTimes(5);
	});

	it("interrupts pending headers and body on source change, rejects late results, and cancels on unmount", async () => {
		const headers = Promise.withResolvers<Response>();
		const bodyReady = Promise.withResolvers<void>();
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			pull() {
				bodyReady.resolve();
			},
			cancel,
		});
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockReturnValueOnce(headers.promise)
			.mockResolvedValueOnce(svgResponse(body))
			.mockResolvedValueOnce(svgResponse())
			.mockResolvedValueOnce(svgResponse(new ReadableStream({ cancel })));
		const { rerender, unmount } = renderWorkspace(fetchMock);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;
		rerender(<SvgIconWorkspace handoff={nextHandoff("body")} />);
		await bodyReady.promise;
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(firstSignal?.aborted).toBe(true);
		const bodySignal = fetchMock.mock.calls[1]?.[1]?.signal;
		rerender(<SvgIconWorkspace handoff={nextHandoff("current")} />);
		expect(await screen.findByLabelText("current.svg editable canvas")).toBeTruthy();
		expect(bodySignal?.aborted).toBe(true);
		expect(cancel).toHaveBeenCalledOnce();
		await act(async () => {
			headers.resolve(svgResponse(blockedSvg));
			await headers.promise;
		});
		expect(screen.getByLabelText("current.svg editable canvas")).toBeTruthy();
		expect(screen.queryByText("Native import unavailable")).toBeNull();
		rerender(<SvgIconWorkspace handoff={nextHandoff("unmount")} />);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
		unmount();
		await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
		expect(fetchMock.mock.calls[3]?.[1]?.signal?.aborted).toBe(true);
		const pending = Promise.withResolvers<Response>();
		const pendingFetch = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
		const pendingView = renderWorkspace(pendingFetch);
		await waitFor(() => expect(pendingFetch).toHaveBeenCalledOnce());
		pendingView.unmount();
		await waitFor(() => expect(pendingFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true));
	});

	it("accepts exactly one million UTF-8 bytes and cancels oversized streams before conversion despite a smaller declared length", async () => {
		const prefix = '<svg viewBox="0 0 20 20"><!--é';
		const suffix = '--><path fill="#f00" d="M0 0H20V20H0Z"/></svg>';
		const encoder = new TextEncoder();
		const exact = encoder.encode(
			prefix + " ".repeat(1_000_000 - encoder.encode(prefix + suffix).length) + suffix,
		);
		const split = encoder.encode(prefix).length - 1;
		const exactBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(exact.slice(0, split));
				controller.enqueue(exact.slice(split));
				controller.close();
			},
		});
		const cancel = vi.fn();
		let chunks = 0;
		const tooLarge = new ReadableStream<Uint8Array>({
			pull(controller) {
				chunks += 1;
				controller.enqueue(new Uint8Array(600_000));
				if (chunks === 4) controller.close();
			},
			cancel,
		});
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(svgResponse(exactBody, { "content-length": "1000000" }))
			.mockResolvedValueOnce(svgResponse(tooLarge, { "content-length": "10" }));
		const { rerender } = renderWorkspace(fetchMock);
		expect(await screen.findByLabelText("sample.svg editable canvas")).toBeTruthy();
		rerender(<SvgIconWorkspace handoff={nextHandoff("too-large")} />);
		await expectUnavailable("Icon SVG exceeds the 1 MB workspace import limit.");
		expect(cancel).toHaveBeenCalledOnce();
		expect(chunks).toBeLessThan(4);
	});
});
