import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDrawnNames } from "./use-drawn-names";

// The hook keeps module state once a write fails, so the stored case runs first.
describe("useDrawnNames", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
	});

	it("keeps the choice in the browser and shares it between pages", () => {
		const first = renderHook(() => useDrawnNames());
		const second = renderHook(() => useDrawnNames());
		expect(first.result.current[0]).toBe(false);

		act(() => first.result.current[1](true));
		expect(window.localStorage.getItem("sketchi-icons:drawn-names")).toBe("on");
		expect(second.result.current[0]).toBe(true);
	});

	it("still switches when storage reads but refuses writes", () => {
		window.localStorage.setItem("sketchi-icons:drawn-names", "off");
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
		});
		const { result } = renderHook(() => useDrawnNames());
		expect(result.current[0]).toBe(false);

		act(() => result.current[1](true));
		expect(setItem).toHaveBeenCalled();
		expect(window.localStorage.getItem("sketchi-icons:drawn-names")).toBe("off");
		expect(result.current[0]).toBe(true);

		act(() => result.current[1](false));
		expect(result.current[0]).toBe(false);
	});
});
