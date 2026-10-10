import { definePlugin, defineRule } from "@oxlint/plugins";
import type { Context, ESTree, Variable } from "@oxlint/plugins";

const reactModule = "react";
const reactEffectHooks: ReadonlySet<string> = new Set([
  "useEffect",
  "useInsertionEffect",
  "useLayoutEffect",
]);

type Node = ESTree.Node;

function moduleExportName(node: Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return undefined;
}

function staticMemberName(node: ESTree.MemberExpression): string | undefined {
  if (!node.computed) {
    return node.property.type === "Identifier" ? node.property.name : undefined;
  }
  if (
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  if (
    node.property.type === "TemplateLiteral" &&
    node.property.expressions.length === 0
  ) {
    return node.property.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

type DestructuringProperty =
  ESTree.AssignmentTargetProperty | ESTree.BindingProperty;

function propertyKeyName(node: DestructuringProperty): string | undefined {
  if (!node.computed) return moduleExportName(node.key);
  return node.key.type === "Literal" && typeof node.key.value === "string"
    ? node.key.value
    : undefined;
}

/**
 * A namespace reference that cannot reach a hook at runtime: types, JSX member
 * tags, and value-discarding operators, such as `React.ReactNode`,
 * `typeof React`, `<React.Fragment>`, or `void React`.
 */
function isInertNamespaceUse(identifier: Node, parent: Node): boolean {
  return (
    (parent.type === "TSQualifiedName" && parent.left === identifier) ||
    (parent.type === "TSTypeQuery" && parent.exprName === identifier) ||
    (parent.type === "JSXMemberExpression" && parent.object === identifier) ||
    (parent.type === "UnaryExpression" &&
      (parent.operator === "void" || parent.operator === "typeof"))
  );
}

/**
 * Keeps direct React effect hooks out of product code. Bindings are resolved
 * through scope analysis, so renamed imports, namespace or default imports,
 * computed members, destructuring, namespace aliases, detached references,
 * and re-exports are all reported at the site that obtains the hook. Any other
 * use of React's namespace (exporting, spreading, assigning, or passing it) is
 * reported too, because the hooks would escape this analysis.
 */
const noReactEffects = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct React effect hooks outside reviewed synchronization adapters.",
    },
    messages: {
      reactEffect:
        "Avoid {{name}} in product code. Derive values during render, react to changes in event handlers, load data with TanStack Query or Router, or subscribe with useSyncExternalStore. Isolate unavoidable third-party synchronization behind a reasoned `oxlint-disable-next-line sketchi/no-react-effects -- <why>`.",
      reactEffectReexport:
        "Do not re-export React effect hooks; a local re-export would hide {{name}} from this rule.",
      reactNamespaceEscape:
        "Use React's namespace only for member access here. Exporting, spreading, assigning, or passing it would hide its effect hooks from this rule.",
      reactNamespaceReexport:
        "Do not re-export React's namespace or default export; a local re-export would hide its effect hooks from this rule.",
    },
    schema: [],
  },
  create(context: Context) {
    const report = (node: Node, name: string): void => {
      context.report({ node, messageId: "reactEffect", data: { name } });
    };

    const visitedNamespaces = new Set<Variable>();

    const reportHookReferences = (variable: Variable, name: string): void => {
      for (const reference of variable.references) {
        if (reference.init) continue;
        report(reference.identifier, name);
      }
    };

    const reportDestructuredHooks = (
      pattern: ESTree.ObjectAssignmentTarget | ESTree.ObjectPattern,
    ): void => {
      for (const property of pattern.properties) {
        if (property.type !== "Property") continue;
        const name = propertyKeyName(property);
        if (name && reactEffectHooks.has(name)) report(property, name);
      }
    };

    const trackNamespace = (variable: Variable): void => {
      if (visitedNamespaces.has(variable)) return;
      visitedNamespaces.add(variable);

      for (const reference of variable.references) {
        if (reference.init || reference.isWrite()) continue;
        const identifier = reference.identifier;
        // The classic JSX transform's implicit React use points at the binding.
        if (variable.identifiers.includes(identifier)) continue;
        const parent = identifier.parent;

        if (isInertNamespaceUse(identifier, parent)) continue;

        if (
          parent.type === "MemberExpression" &&
          parent.object === identifier
        ) {
          const name = staticMemberName(parent);
          if (name && reactEffectHooks.has(name)) report(parent, name);
          continue;
        }

        if (
          parent.type === "VariableDeclarator" &&
          parent.init === identifier
        ) {
          if (parent.id.type === "ObjectPattern") {
            reportDestructuredHooks(parent.id);
          } else {
            for (const alias of context.sourceCode.getDeclaredVariables(
              parent,
            )) {
              trackNamespace(alias);
            }
          }
          continue;
        }

        if (
          parent.type === "AssignmentExpression" &&
          parent.right === identifier &&
          parent.left.type === "ObjectPattern"
        ) {
          reportDestructuredHooks(parent.left);
          continue;
        }

        context.report({ node: identifier, messageId: "reactNamespaceEscape" });
      }
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== reactModule || node.importKind === "type") {
          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            if (specifier.importKind === "type") continue;
            const name = moduleExportName(specifier.imported);
            if (!name || !reactEffectHooks.has(name)) continue;
            for (const variable of context.sourceCode.getDeclaredVariables(
              specifier,
            )) {
              reportHookReferences(variable, name);
            }
            continue;
          }

          for (const variable of context.sourceCode.getDeclaredVariables(
            specifier,
          )) {
            trackNamespace(variable);
          }
        }
      },
      ImportExpression(node) {
        if (
          node.source.type !== "Literal" ||
          node.source.value !== reactModule
        ) {
          return;
        }
        const awaited =
          node.parent.type === "AwaitExpression" ? node.parent : undefined;
        const declarator = awaited?.parent;
        if (
          declarator?.type !== "VariableDeclarator" ||
          declarator.init !== awaited
        ) {
          return;
        }
        if (declarator.id.type === "ObjectPattern") {
          reportDestructuredHooks(declarator.id);
          return;
        }
        for (const variable of context.sourceCode.getDeclaredVariables(
          declarator,
        )) {
          trackNamespace(variable);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source?.value !== reactModule || node.exportKind === "type") {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.exportKind === "type") continue;
          const name = moduleExportName(specifier.local);
          if (name === "default") {
            context.report({
              node: specifier,
              messageId: "reactNamespaceReexport",
            });
          } else if (name && reactEffectHooks.has(name)) {
            context.report({
              node: specifier,
              messageId: "reactEffectReexport",
              data: { name },
            });
          }
        }
      },
      ExportAllDeclaration(node) {
        if (node.source.value !== reactModule || node.exportKind === "type") {
          return;
        }
        if (node.exported) {
          context.report({ node, messageId: "reactNamespaceReexport" });
          return;
        }
        context.report({
          node,
          messageId: "reactEffectReexport",
          data: { name: "React's effect hooks" },
        });
      },
    };
  },
});

interface RestrictedImportTypeOptions {
  readonly modules: ReadonlyArray<{
    readonly message: string;
    readonly name: string;
  }>;
}

/**
 * `no-restricted-imports` does not inspect `import("…")` types, so a type
 * query such as `typeof import("effect")` would bypass the import policy.
 * Each restricted module covers its subpaths, and a scope such as `@effect`
 * covers every package in it.
 */
const noRestrictedImportTypes = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Apply the repository's import restrictions to TypeScript import types.",
    },
    messages: {
      restricted: "'{{specifier}}' import type is restricted. {{message}}",
    },
    schema: [
      {
        type: "object",
        properties: {
          modules: {
            type: "array",
            items: {
              type: "object",
              properties: {
                message: { type: "string" },
                name: { type: "string" },
              },
              required: ["message", "name"],
              additionalProperties: false,
            },
          },
        },
        required: ["modules"],
        additionalProperties: false,
      },
    ],
  },
  create(context: Context) {
    const options = context.options[0] as
      RestrictedImportTypeOptions | undefined;
    const modules = options?.modules ?? [];
    return {
      TSImportType(node) {
        const specifier = node.source.value;
        const restricted = modules.find(
          ({ name }) => specifier === name || specifier.startsWith(`${name}/`),
        );
        if (!restricted) return;
        context.report({
          node: node.source,
          messageId: "restricted",
          data: { message: restricted.message, specifier },
        });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "sketchi" },
  rules: {
    "no-react-effects": noReactEffects,
    "no-restricted-import-types": noRestrictedImportTypes,
  },
});
