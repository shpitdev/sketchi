import { RegistryProvider } from "@effect/atom-react";
import { Layer, Tracer } from "effect";
import { FetchHttpClient } from "effect/http";
import { type ReactNode } from "react";
import { type ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sketchi/editor", async (original) => ({
	...(await original<typeof import("@sketchi/editor")>()),
	DrawingEditor: ({
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

import { parseSvgHandoff, type SvgHandoff } from "../lib/svg-handoff";
import { svgHttpLayer } from "../lib/svg-source-atom";
import {
	SvgIconWorkspace,
	type SvgIconWorkspaceProps,
} from "../components/svg-icon-workspace/svg-icon-workspace";

describe("SVG handoff", () => {
	it("accepts a public Sketchi Icons SVG", () => {
		expect(
			parseSvgHandoff({
				svg: "https://icons.sketchi.app/output/upload-ready/svg/auth-identity/workos.svg",
			}),
		).toMatchObject({ kind: "valid" });
	});

	it.each([
		"https://example.com/output/upload-ready/svg/auth/workos.svg",
		"https://sketchi-icons.attacker.workers.dev/output/upload-ready/svg/auth/workos.svg",
		"https://evil-sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/auth/workos.svg",
		"https://pr-91-sketchi-studio.dimethyl.workers.dev/output/upload-ready/svg/auth/workos.svg",
		"https://sketchi-icons.dimethyl.workers.dev:444/output/upload-ready/svg/auth/workos.svg",
		"https://sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/auth/workos.svg?raw=1",
		"https://sketchi-icons.dimethyl.workers.dev/output/review/review-data.json",
		"https://sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/../reports/private.svg",
		"http://sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/auth/workos.svg",
	])("rejects non-contract source %s", (svg) => {
		expect(parseSvgHandoff({ svg })).toMatchObject({ kind: "invalid" });
	});
});

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

function renderWorkspace(
	fetch: typeof globalThis.fetch,
	props: SvgIconWorkspaceProps = { handoff },
	tracer: Tracer.Tracer = Tracer.nativeTracer,
) {
	return render(<SvgIconWorkspace {...props} />, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<RegistryProvider
				initialValues={[
					[
						svgHttpLayer,
						Layer.merge(
							FetchHttpClient.layer.pipe(
								Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
							),
							Layer.succeed(Tracer.Tracer, tracer),
						),
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

describe("SVG icon workspace", () => {
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
