import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Reasoning, ReasoningTrigger } from "./reasoning";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it.each([true, false])("preserves manual expansion when opened during streaming: %s", async (during) => {
	vi.useFakeTimers();
	const view = (streaming: boolean) => (
		<Reasoning defaultOpen={false} isStreaming={streaming}>
			<ReasoningTrigger>Reasoning</ReasoningTrigger>
		</Reasoning>
	);
	const { rerender } = render(view(true));
	const trigger = screen.getByRole("button", { name: "Reasoning" });
	if (during) fireEvent.click(trigger);
	rerender(view(false));
	if (!during) fireEvent.click(trigger);
	await act(() => vi.advanceTimersByTime(1100));
	expect(trigger.getAttribute("aria-expanded")).toBe("true");
});
