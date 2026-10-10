import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./sketchi-plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    sourceType: "module",
    parserOptions: { lang: "tsx" },
  },
});

const noReactEffects = plugin.rules["no-react-effects"];
if (!noReactEffects)
  throw new Error("sketchi/no-react-effects is not registered.");

const reactEffect = (name: string) => ({
  messageId: "reactEffect",
  data: { name },
});
const reexport = (name: string) => ({
  messageId: "reactEffectReexport",
  data: { name },
});
const namespaceEscape = { messageId: "reactNamespaceEscape" };
const namespaceReexport = { messageId: "reactNamespaceReexport" };

tester.run("no-react-effects", noReactEffects, {
  valid: [
    {
      name: "non-effect React hooks",
      code: 'import { useMemo, useState, useSyncExternalStore } from "react"; useState(0); useMemo(() => 1, []); useSyncExternalStore(subscribe, read);',
    },
    {
      name: "namespace access to non-effect hooks",
      code: 'import * as React from "react"; React.useState(0); React["useMemo"](() => 1, []);',
    },
    {
      name: "same-named function from another module",
      code: 'import { useEffect } from "./timeline"; useEffect();',
    },
    {
      name: "locally declared useEffect",
      code: "const useEffect = (run: () => void) => run(); useEffect(() => {});",
    },
    {
      name: "parameter shadows the imported hook",
      code: 'import { useEffect } from "react"; export function adapt(useEffect: (run: () => void) => void) { useEffect(() => {}); }',
    },
    {
      name: "unrelated object with an effect-named member",
      code: 'import * as React from "react"; const scheduler = { useEffect() {} }; scheduler.useEffect(); void React;',
    },
    {
      name: "Effect library generators are not React effects",
      code: 'import { Effect } from "effect"; Effect.gen(function* () { yield* Effect.void; });',
    },
    {
      name: "type-only React imports",
      code: 'import type { EffectCallback } from "react"; import { type DependencyList } from "react"; export type Hook = (run: EffectCallback, deps: DependencyList) => void;',
    },
    {
      name: "re-exporting non-effect hooks",
      code: 'export { useState, useMemo } from "react";',
    },
    {
      name: "awaited dynamic import of another module",
      code: 'const timeline = await import("./timeline"); timeline.useEffect();',
    },
    {
      name: "dynamic member access cannot be resolved statically",
      code: 'import * as React from "react"; declare const hook: "useState"; React[hook](0);',
    },
    {
      name: "namespace in types and JSX member tags",
      code: 'import * as React from "react"; type Hook = typeof React; type Use = typeof React.useEffect; export function Frame(props: { children: React.ReactNode }) { return <React.Fragment>{props.children}</React.Fragment>; }',
    },
    {
      name: "type-only re-export of the default",
      code: 'export type { default as ReactDefault } from "react";',
    },
  ],
  invalid: [
    {
      name: "named useEffect call",
      code: 'import { useEffect } from "react"; useEffect(() => {}, []);',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "named useLayoutEffect and useInsertionEffect calls",
      code: 'import { useInsertionEffect, useLayoutEffect } from "react"; useLayoutEffect(() => {}); useInsertionEffect(() => {});',
      errors: [
        reactEffect("useLayoutEffect"),
        reactEffect("useInsertionEffect"),
      ],
    },
    {
      name: "renamed import alias",
      code: 'import { useEffect as useMountEffect } from "react"; useMountEffect(() => {});',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "string-named import alias",
      code: 'import { "useLayoutEffect" as layout } from "react"; layout(() => {});',
      errors: [reactEffect("useLayoutEffect")],
    },
    {
      name: "namespace import member",
      code: 'import * as React from "react"; React.useEffect(() => {});',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "default import member",
      code: 'import React from "react"; React.useLayoutEffect(() => {});',
      errors: [reactEffect("useLayoutEffect")],
    },
    {
      name: "computed namespace member",
      code: 'import * as React from "react"; React["useEffect"](() => {}); React[`useLayoutEffect`](() => {});',
      errors: [reactEffect("useEffect"), reactEffect("useLayoutEffect")],
    },
    {
      name: "destructured from the namespace",
      code: 'import * as React from "react"; const { useEffect: run, useState } = React; run(() => {}); useState(0);',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "destructuring assignment from the namespace",
      code: 'import React from "react"; let run; ({ useLayoutEffect: run } = React); run(() => {});',
      errors: [reactEffect("useLayoutEffect")],
    },
    {
      name: "namespace alias chain",
      code: 'import * as React from "react"; const R = React; const Again = R; Again.useEffect(() => {});',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "awaited dynamic import namespace",
      code: 'const React = await import("react"); React.useEffect(() => {});',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "destructured awaited dynamic import",
      code: 'const { useLayoutEffect } = await import("react"); useLayoutEffect(() => {});',
      errors: [reactEffect("useLayoutEffect")],
    },
    {
      name: "detached hook reference",
      code: 'import { useEffect } from "react"; const run = useEffect; run(() => {});',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "local re-export of an imported hook",
      code: 'import { useEffect } from "react"; export { useEffect };',
      errors: [reactEffect("useEffect")],
    },
    {
      name: "re-export from react",
      code: 'export { useEffect as useMountEffect, useState } from "react";',
      errors: [reexport("useEffect")],
    },
    {
      name: "wildcard re-export from react",
      code: 'export * from "react";',
      errors: [reexport("React's effect hooks")],
    },
    {
      name: "re-exported default import",
      code: 'export { default as R } from "react";',
      errors: [namespaceReexport],
    },
    {
      name: "re-exported default under its own name",
      code: 'export { default, useState } from "react";',
      errors: [namespaceReexport],
    },
    {
      name: "namespace re-export",
      code: 'export * as R from "react";',
      errors: [namespaceReexport],
    },
    {
      name: "local export of the namespace",
      code: 'import * as React from "react"; export { React };',
      errors: [namespaceEscape],
    },
    {
      name: "default export of the default import",
      code: 'import React from "react"; export default React;',
      errors: [namespaceEscape],
    },
    {
      name: "namespace spread into an object",
      code: 'import * as React from "react"; const hooks = { ...React }; hooks.useEffect(() => {});',
      errors: [namespaceEscape],
    },
    {
      name: "namespace assigned to another binding",
      code: 'import * as React from "react"; let R; R = React; R.useLayoutEffect(() => {});',
      errors: [namespaceEscape],
    },
    {
      name: "namespace passed to a function",
      code: 'import * as React from "react"; declare function register(hooks: typeof React): void; register(React);',
      errors: [namespaceEscape],
    },
    {
      name: "namespace laundered through an assertion",
      code: 'import * as React from "react"; (React as typeof React).useEffect(() => {});',
      errors: [namespaceEscape],
    },
    {
      name: "aliased namespace escaping through an array",
      code: 'import * as React from "react"; const R = React; export const modules = [R];',
      errors: [namespaceEscape],
    },
    {
      name: "effects inside a component body",
      code: 'import React, { useEffect } from "react"; export function Panel() { useEffect(() => {}, []); React.useLayoutEffect(() => {}); return <div />; }',
      errors: [reactEffect("useEffect"), reactEffect("useLayoutEffect")],
    },
  ],
});

const noRestrictedImportTypes = plugin.rules["no-restricted-import-types"];
if (!noRestrictedImportTypes) {
  throw new Error("sketchi/no-restricted-import-types is not registered.");
}

const effectFree = [
  {
    modules: [
      { name: "effect", message: "Keep Effect out." },
      { name: "@effect", message: "Keep Effect out." },
    ],
  },
];
const restricted = (specifier: string) => ({
  messageId: "restricted",
  data: { message: "Keep Effect out.", specifier },
});

tester.run("no-restricted-import-types", noRestrictedImportTypes, {
  valid: [
    {
      name: "unrestricted import types",
      code: 'type Local = import("./local").Value; type Node = typeof import("node:fs");',
      options: effectFree,
    },
    {
      name: "a package whose name only starts like a restricted one",
      code: 'type Polyfill = typeof import("effects-polyfill"); type Scoped = import("@effective/tools").T;',
      options: effectFree,
    },
    {
      name: "type-only import declarations are no-restricted-imports' job",
      code: 'import type { Effect } from "effect"; export type E = Effect.Effect<number>;',
      options: effectFree,
    },
    {
      name: "no configured modules",
      code: 'type E = typeof import("effect");',
    },
  ],
  invalid: [
    {
      name: "type query of a restricted module",
      code: 'type EffectModule = typeof import("effect");',
      options: effectFree,
      errors: [restricted("effect")],
    },
    {
      name: "deep subpath of a restricted module",
      code: 'let run: import("effect/Effect").Effect<number>;',
      options: effectFree,
      errors: [restricted("effect/Effect")],
    },
    {
      name: "deep path inside a restricted scope",
      code: 'type Runtime = typeof import("@effect/platform-node/NodeRuntime");',
      options: effectFree,
      errors: [restricted("@effect/platform-node/NodeRuntime")],
    },
    {
      name: "qualified and generic import types",
      code: 'type Layer = import("effect").Layer.Layer<never>; type Many = Array<typeof import("@effect/vitest")>;',
      options: effectFree,
      errors: [restricted("effect"), restricted("@effect/vitest")],
    },
  ],
});
