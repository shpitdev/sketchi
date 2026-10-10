import { describe, expect, it } from "vitest";

import { parseSvgHandoff, validateSvgHandoffSearch } from "./svg-handoff";

describe("parseSvgHandoff", () => {
	it("accepts preview-aware public Sketchi SVG URLs and typed controls", () => {
		expect(
			parseSvgHandoff(
				validateSvgHandoffSearch({
					svg: "https://pr-91-sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/auth-identity/workos.svg",
					roughness: "2",
					fillStyle: "hachure",
					colorMode: "monochrome",
					color: "#5F3DC4",
				}),
			),
		).toEqual({
			kind: "valid",
			handoff: {
				sourceUrl:
					"https://pr-91-sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/auth-identity/workos.svg",
				options: {
					roughness: 2,
					fillStyle: "hachure",
					colorProfile: { color: "#5f3dc4", kind: "monochrome" },
				},
			},
		});
	});

	it("accepts branch-local Icons handoffs for real browser proof", () => {
		expect(
			parseSvgHandoff({
				roughness: 2,
				svg: "https://svg-native-conversion-ui.icons.sketchi.localhost/output/upload-ready/svg/ai-apps-agents/ace.svg",
			}),
		).toMatchObject({
			kind: "valid",
			handoff: { options: { roughness: 2 } },
		});
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

	it("normalizes invalid options once before applying defaults", () => {
		const svg = "https://icons.sketchi.app/output/upload-ready/svg/auth-identity/workos.svg";
		expect(
			parseSvgHandoff(
				validateSvgHandoffSearch({
					svg,
					color: "red",
					colorMode: "unknown",
					fillStyle: "unknown",
					roughness: "9",
				}),
			),
		).toMatchObject({
			handoff: {
				options: {
					roughness: 1,
					fillStyle: "solid",
					colorProfile: { kind: "preserve" },
				},
			},
		});
		expect(
			parseSvgHandoff(
				validateSvgHandoffSearch({
					svg,
					colorMode: "monochrome",
					color: "bad",
					roughness: "0",
				}),
			),
		).toMatchObject({
			handoff: {
				options: {
					roughness: 0,
					colorProfile: { kind: "monochrome", color: "#1e1e1e" },
				},
			},
		});
	});

	it("returns the sample workspace contract when no handoff exists", () => {
		expect(parseSvgHandoff({})).toEqual({ kind: "absent" });
	});
});
