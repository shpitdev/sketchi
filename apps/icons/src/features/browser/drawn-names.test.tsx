import { Array as Arr } from "effect";
import { RegistryContext, useAtom } from "@effect/atom-react";
import { act, renderHook } from "@testing-library/react";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawnNames, DRAWN_NAMES_KEY } from "./drawn-names";

const owners: AtomRegistry.AtomRegistry[] = [];
function owner() {
	const registry = AtomRegistry.make({ defaultIdleTTL: 0 });
	owners.push(registry);
	return {
		registry,
		wrapper: ({ children }: { readonly children: React.ReactNode }) => (
			<RegistryContext value={registry}>{children}</RegistryContext>
		),
	};
}
// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
async function storage(key: string | null = DRAWN_NAMES_KEY) {
	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	await act(async () => {
		window.dispatchEvent(new StorageEvent("storage", { key }));
	});
}
afterEach(() => {
	Arr.forEach(owners.splice(0), (owner) => owner.dispose());
	vi.restoreAllMocks();
	localStorage.clear();
});
describe("drawn names browser preference", () => {
	it.each(["on", "off", "invalid", null])(
		"reads raw %s without writing and shares changes across consumers",
		(raw) => {
			if (raw !== null) localStorage.setItem(DRAWN_NAMES_KEY, raw);
			const write = vi.spyOn(Storage.prototype, "setItem");
			const scope = owner();
			const first = renderHook(() => useAtom(drawnNames), scope);
			const second = renderHook(() => useAtom(drawnNames), scope);
			expect(first.result.current[0]).toBe(raw === "on");
			expect(write).not.toHaveBeenCalled();
			act(() => first.result.current[1](true));
			expect(localStorage.getItem(DRAWN_NAMES_KEY)).toBe("on");
			expect(second.result.current[0]).toBe(true);
			act(() => second.result.current[1](false));
			expect(localStorage.getItem(DRAWN_NAMES_KEY)).toBe("off");
			expect(first.result.current[0]).toBe(false);
		},
	);
	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	it("follows other tabs' set, remove and clear while ignoring unrelated keys and session storage", async () => {
		const scope = owner();
		const hook = renderHook(() => useAtom(drawnNames), scope);
		localStorage.setItem(DRAWN_NAMES_KEY, "on");
		await storage();
		expect(hook.result.current[0]).toBe(true);
		localStorage.setItem(DRAWN_NAMES_KEY, "off");
		await storage("unrelated");
		expect(hook.result.current[0]).toBe(true);
		await act(() =>
			window.dispatchEvent(
				new StorageEvent("storage", { key: DRAWN_NAMES_KEY, storageArea: sessionStorage }),
			),
		);
		expect(hook.result.current[0]).toBe(true);
		localStorage.removeItem(DRAWN_NAMES_KEY);
		await storage();
		expect(hook.result.current[0]).toBe(false);
		localStorage.setItem(DRAWN_NAMES_KEY, "on");
		await storage();
		localStorage.clear();
		await storage(null);
		expect(hook.result.current[0]).toBe(false);
	});
	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	it("retains the latest local choice through failed reads and recovers when reading works", async () => {
		const hook = renderHook(() => useAtom(drawnNames), owner());
		act(() => hook.result.current[1](true));
		const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("refused", "SecurityError");
		});
		await storage();
		expect(hook.result.current[0]).toBe(true);
		act(() => hook.result.current[1](false));
		await storage();
		expect(hook.result.current[0]).toBe(false);
		read.mockRestore();
		localStorage.setItem(DRAWN_NAMES_KEY, "on");
		await storage();
		expect(hook.result.current[0]).toBe(true);
	});
	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	it("keeps local choices after failed writes even if later writes and cross-tab reads succeed", async () => {
		localStorage.setItem(DRAWN_NAMES_KEY, "off");
		const scope = owner();
		const hook = renderHook(() => useAtom(drawnNames), scope);
		const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("full", "QuotaExceededError");
		});
		act(() => hook.result.current[1](true));
		expect(hook.result.current[0]).toBe(true);
		await storage();
		expect(hook.result.current[0]).toBe(true);
		act(() => hook.result.current[1](false));
		expect(hook.result.current[0]).toBe(false);
		write.mockRestore();
		act(() => hook.result.current[1](true));
		localStorage.setItem(DRAWN_NAMES_KEY, "off");
		await storage();
		expect(hook.result.current[0]).toBe(true);
		hook.unmount();
		const remount = renderHook(() => useAtom(drawnNames), scope);
		expect(remount.result.current[0]).toBe(true);
	});
	// @effect-diagnostics-next-line asyncFunction:off -- The browser event stream and storage denial are driven at their native test boundary.
	it("survives denial of the localStorage getter and resumes cross-tab updates", async () => {
		localStorage.setItem(DRAWN_NAMES_KEY, "on");
		const area = localStorage;
		const hook = renderHook(() => useAtom(drawnNames), owner());
		const access = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
			throw new DOMException("denied", "SecurityError");
		});
		// @effect-diagnostics-next-line asyncFunction:off -- React act drains the native storage event before assertions.
		await act(async () => {
			window.dispatchEvent(
				new StorageEvent("storage", { key: DRAWN_NAMES_KEY, storageArea: area }),
			);
		});
		expect(hook.result.current[0]).toBe(true);
		access.mockRestore();
		area.setItem(DRAWN_NAMES_KEY, "off");
		await storage();
		expect(hook.result.current[0]).toBe(false);
	});

	// @effect-diagnostics-next-line asyncFunction:off -- Initial storage acquisition failure and later native browser events exercise the feature's recovery path.
	it("recovers from initial localStorage getter denial on later events and actions", async () => {
		const area = localStorage;
		area.setItem(DRAWN_NAMES_KEY, "on");
		const access = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
			throw new DOMException("initially denied", "SecurityError");
		});
		const hook = renderHook(() => useAtom(drawnNames), owner());
		expect(hook.result.current[0]).toBe(false);
		access.mockRestore();
		await storage();
		expect(hook.result.current[0]).toBe(true);
		act(() => hook.result.current[1](false));
		expect(area.getItem(DRAWN_NAMES_KEY)).toBe("off");
		expect(hook.result.current[0]).toBe(false);
	});
});
