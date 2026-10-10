import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, downloadBlob } from "./browser-actions";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
describe("diagram browser actions", () => {
	it("uses the Clipboard API when available", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		await copyText("diagram IR");
		expect(writeText).toHaveBeenCalledWith("diagram IR");
	});
	it("copies through a temporary field when clipboard is unavailable", async () => {
		vi.stubGlobal("navigator", {});
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		await copyText("diagram IR");
		expect(execCommand).toHaveBeenCalledWith("copy");
		expect(document.querySelector("textarea")).toBeNull();
	});
	it("surfaces clipboard failures and removes its field", async () => {
		vi.stubGlobal("navigator", {});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: vi.fn().mockReturnValue(false),
		});
		await expect(copyText("diagram IR")).rejects.toThrow("Clipboard copy failed.");
		expect(document.querySelector("textarea")).toBeNull();
	});
	it("downloads the exact blob and releases its object URL", () => {
		const blob = new Blob(["scene"]);
		const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:diagram");
		const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			expect(this.href).toBe("blob:diagram");
			expect(this.download).toBe("scene.excalidrawlib");
		});
		downloadBlob(blob, "scene.excalidrawlib");
		expect(create).toHaveBeenCalledWith(blob);
		expect(click).toHaveBeenCalledOnce();
		expect(revoke).toHaveBeenCalledWith("blob:diagram");
	});
});
