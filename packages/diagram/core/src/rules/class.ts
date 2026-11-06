import type { RuleSource } from "./source.js";

/** How a request becomes a UML class diagram; see FLOWCHART_RULES. */
export const CLASS_RULES = {
	members:
		'Write each member as UML does: attributes "- radius: double", "+ count: int {static}"; methods "+ area(): double", "+ draw(ctx: Canvas): void {abstract}". Visibility is +, -, # or ~.',
	kinds:
		'kind is "abstract", "interface" or "enum" (its values are attributes), or omitted for a class.',
	ids: "Ids hold no colon or space; name defaults to the id.",
	relationships:
		'kind "inheritance" or "realization": from extends or implements to; "composition" or "aggregation": from is the whole; "association"; "dependency": from uses to.',
	multiplicities:
		'Multiplicities ("1", "0..1", "*", "1..*"), roles and navigable (an open arrow at to) go on compositions, aggregations and associations only; a composition\'s whole is "1" or "0..1".',
	/** The execute code parameter's form of `multiplicities`. */
	multiplicitiesCompact:
		'Multiplicities ("1", "0..*") and roles go on compositions, aggregations and associations only.',
	hierarchy: "Interfaces extend only interfaces, and inheritance never cycles.",
	typedFields: (source: RuleSource) =>
		`A field typed as another class stays in attributes and also draws a relationship whose toRole is the field's name. It is an association; only pairs ${source} calls composed or aggregated take those kinds. A cast to or call on another class inside a method body draws a dependency.`,
	copy: (source: RuleSource) =>
		`Copy every class, member, relationship, multiplicity and role ${source} states; invent none.`,
} as const;
