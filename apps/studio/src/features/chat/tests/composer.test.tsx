import { fireEvent, within } from "@testing-library/react";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { StudioComposer } from "../surface";

it("does not submit a draft from the server-rendered composer", () => {
	const container = document.createElement("div");
	container.innerHTML = renderToString(
		<StudioComposer
			buildMode={false}
			composerRef={createRef<HTMLTextAreaElement>()}
			onSubmit={() => undefined}
			status="ready"
		/>,
	);
	const submit = vi.fn((event: Event) => event.preventDefault());
	container.addEventListener("submit", submit);
	document.body.append(container);
	try {
		const composer = within(container);
		const draft = composer.getByRole("textbox");
		fireEvent.input(draft, { target: { value: "Draw a flowchart" } });
		composer.getByRole("button", { name: "Send" }).click();
		expect(submit).not.toHaveBeenCalled();
		expect(draft).toHaveProperty("value", "Draw a flowchart");
	} finally {
		container.remove();
	}
});
