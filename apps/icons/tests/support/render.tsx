import { RegistryContext } from "@effect/atom-react";
import { render as renderReact, type RenderOptions } from "@testing-library/react";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { queryHttpLayer } from "../../src/features/browser/query";
import { AtomRegistry } from "effect/reactivity";
import type { ReactElement } from "react";
import { afterEach } from "vitest";

const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => {
	for (const registry of registries.splice(0)) registry.dispose();
});
/** Each rendered app has the same registry boundary as the real Icons root. */
export function render(ui: ReactElement, options?: RenderOptions) {
	const registry = AtomRegistry.make({ defaultIdleTTL: 0 });
	registries.push(registry);
	registry.set(
		queryHttpLayer,
		FetchHttpClient.layer.pipe(
			Layer.provide(Layer.succeed(FetchHttpClient.Fetch, (...args) => globalThis.fetch(...args))),
		),
	);
	return renderReact(ui, {
		...options,
		wrapper: ({ children }) => <RegistryContext value={registry}>{children}</RegistryContext>,
	});
}
