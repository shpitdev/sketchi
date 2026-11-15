import { CLASS_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Class diagram", hint: "best for UML classes, members and relationships" },
	summary: "UML classes, members and relationships",
	fastPath: `spec: { title, classes: [{ id, kind?: "abstract" | "interface" | "enum", attributes?: ["- id: UUID"], methods?: ["+ area(): double {abstract}"] }], relationships: [{ kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }] }. ${CLASS_RULES.relationships} ${CLASS_RULES.multiplicitiesCompact}`,
	codeHint: undefined,
	catalogOrder: 10,
	fastPathOrder: 7,
	studioOrder: 7,
	toolName: "build_class_diagram" as const,
	toolDescription:
		'Build and persist a native UML class diagram: classes, interfaces and enums drawn as boxes of name, attributes and methods, superclasses above their subclasses, and relationships drawn with their UML heads: inheritance and realization (from extends or implements to) with hollow triangles, composition and aggregation (from is the whole) with filled and hollow diamonds, association (navigable: true adds an arrow) and dependency (dashed arrow). Members may be strings "- name: Type" and "+ name(p: Type): Return"; associations, compositions and aggregations take multiplicities and roles at each end. The host lays out the boxes. Repair structured issues, up to three total attempts.',

	entry: (requestType: string) => ({
		id: "buildClassDiagram",
		kind: "operation" as const,
		title: "buildClassDiagram",
		topic: "buildClassDiagram" as const,
		keywords: [
			"class diagram",
			"uml",
			"classes",
			"interface",
			"inheritance",
			"composition",
			"aggregation",
			"object model",
		],
		snippet: "Create a native UML class diagram from classes, their members, and relationships.",
		content: [
			"buildClassDiagram accepts { spec: { id?, title, classes: [{ id, name?, kind?, stereotype?, attributes, methods }], relationships: [{ id?, kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }] }, options? }. The renderer draws each class as a box of name, attributes and methods, superclasses and interfaces above the classes that extend or implement them, and each relationship with its UML line and head.",
			`${CLASS_RULES.members} ${CLASS_RULES.kinds} ${CLASS_RULES.ids}`,
			[
				CLASS_RULES.relationships,
				CLASS_RULES.multiplicities,
				CLASS_RULES.hierarchy,
				CLASS_RULES.typedFields(PROMPT),
				CLASS_RULES.onlyStated(PROMPT),
			].join(" "),
			CLASS_RULES.copy(PROMPT),
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Shapes and a canvas",
				language: "js" as const,
				code: `async () => sketchi.buildClassDiagram({ spec: { title: "Shapes", classes: [{ id: "Shape", kind: "abstract", attributes: ["# x: double"], methods: ["+ area(): double {abstract}"] }, { id: "Circle", attributes: ["- radius: double"], methods: ["+ area(): double"] }, { id: "Canvas", methods: ["+ add(s: Shape): void"] }], relationships: [{ kind: "inheritance", from: "Circle", to: "Shape" }, { kind: "aggregation", from: "Canvas", to: "Shape", fromMultiplicity: "1", toMultiplicity: "0..*", toRole: "shapes" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
