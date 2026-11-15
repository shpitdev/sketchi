/** Patient intake whose valid-insurance branch and self-pay branch both end at routine scheduling. From a generated eval sample. */
export default {
	id: "patient-intake-scheduling",
	title: "Patient Intake Scheduling",
	nodes: [
		{
			id: "request",
			label: "Patient requests an appointment",
			kind: "start",
		},
		{
			id: "intake",
			label: "Clinic collects intake information",
			kind: "process",
		},
		{
			id: "urgent",
			label: "Are there urgent symptoms?",
			kind: "decision",
		},
		{
			id: "triage",
			label: "Nurse triage",
			kind: "process",
		},
		{
			id: "same-day",
			label: "Same-day appointment",
			kind: "end",
		},
		{
			id: "insurance",
			label: "Is insurance valid?",
			kind: "decision",
		},
		{
			id: "routine",
			label: "Schedule a routine appointment",
			kind: "end",
		},
		{
			id: "self-pay",
			label: "Does the patient accept self-pay?",
			kind: "decision",
		},
		{
			id: "billing",
			label: "Refer to billing",
			kind: "end",
		},
	],
	edges: [
		{
			id: "edge-1",
			source: "request",
			target: "intake",
		},
		{
			id: "edge-2",
			source: "intake",
			target: "urgent",
		},
		{
			id: "edge-3",
			source: "urgent",
			target: "triage",
			label: "Yes",
		},
		{
			id: "edge-4",
			source: "triage",
			target: "same-day",
		},
		{
			id: "edge-5",
			source: "urgent",
			target: "insurance",
			label: "No",
		},
		{
			id: "edge-6",
			source: "insurance",
			target: "routine",
			label: "Valid",
		},
		{
			id: "edge-7",
			source: "insurance",
			target: "self-pay",
			label: "Invalid",
		},
		{
			id: "edge-8",
			source: "self-pay",
			target: "routine",
			label: "Yes",
		},
		{
			id: "edge-9",
			source: "self-pay",
			target: "billing",
			label: "No",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
