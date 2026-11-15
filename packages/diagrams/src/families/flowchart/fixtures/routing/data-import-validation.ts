export default {
	id: "data-import-validation",
	title: "Data import validation",
	nodes: [
		{
			id: "upload",
			label: "File uploaded",
			kind: "start",
		},
		{
			id: "parse",
			label: "Parse file",
			kind: "process",
		},
		{
			id: "parse_ok",
			label: "Parsing succeeded?",
			kind: "decision",
		},
		{
			id: "reject",
			label: "Reject file",
			kind: "process",
		},
		{
			id: "rejected_end",
			label: "File rejected",
			kind: "end",
		},
		{
			id: "validate",
			label: "Validate schema",
			kind: "process",
		},
		{
			id: "schema_ok",
			label: "Schema valid?",
			kind: "decision",
		},
		{
			id: "mapping_errors",
			label: "Return mapping errors",
			kind: "process",
		},
		{
			id: "mapping_end",
			label: "Mapping errors returned",
			kind: "end",
		},
		{
			id: "dedupe",
			label: "Deduplicate records",
			kind: "process",
		},
		{
			id: "dup_found",
			label: "Duplicates found?",
			kind: "decision",
		},
		{
			id: "merge",
			label: "Merge duplicates",
			kind: "process",
		},
		{
			id: "import",
			label: "Import records",
			kind: "process",
		},
		{
			id: "done",
			label: "Import complete",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "upload",
			target: "parse",
		},
		{
			id: "edge-2",
			source: "parse",
			target: "parse_ok",
		},
		{
			id: "edge-3",
			source: "parse_ok",
			target: "reject",
			label: "No",
		},
		{
			id: "edge-4",
			source: "reject",
			target: "rejected_end",
		},
		{
			id: "edge-5",
			source: "parse_ok",
			target: "validate",
			label: "Yes",
		},
		{
			id: "edge-6",
			source: "validate",
			target: "schema_ok",
		},
		{
			id: "edge-7",
			source: "schema_ok",
			target: "mapping_errors",
			label: "No",
		},
		{
			id: "edge-8",
			source: "mapping_errors",
			target: "mapping_end",
		},
		{
			id: "edge-9",
			source: "schema_ok",
			target: "dedupe",
			label: "Yes",
		},
		{
			id: "edge-10",
			source: "dedupe",
			target: "dup_found",
		},
		{
			id: "edge-11",
			source: "dup_found",
			target: "merge",
			label: "Yes",
		},
		{
			id: "edge-12",
			source: "merge",
			target: "import",
		},
		{
			id: "edge-13",
			source: "dup_found",
			target: "import",
			label: "No",
		},
		{
			id: "edge-14",
			source: "import",
			target: "done",
		},
	],
	layout: {
		direction: "TB",
	},
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
