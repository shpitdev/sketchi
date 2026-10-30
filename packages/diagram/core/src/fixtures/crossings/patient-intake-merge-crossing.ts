/** Patient intake whose valid-insurance and self-pay branches crossed on their way into routine scheduling, with labels a little shorter than the detour sample. Round 29 (Sol). */
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
			label: "Collect intake information",
			kind: "process",
		},
		{
			id: "urgent",
			label: "Urgent symptoms?",
			kind: "decision",
		},
		{
			id: "triage",
			label: "Nurse triage",
			kind: "process",
		},
		{
			id: "same",
			label: "Same-day appointment",
			kind: "end",
		},
		{
			id: "insurance",
			label: "Insurance valid?",
			kind: "decision",
		},
		{
			id: "routine",
			label: "Schedule routine appointment",
			kind: "end",
		},
		{
			id: "self",
			label: "Patient accepts self-pay?",
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
			target: "same",
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
			label: "Yes",
		},
		{
			id: "edge-7",
			source: "insurance",
			target: "self",
			label: "No",
		},
		{
			id: "edge-8",
			source: "self",
			target: "routine",
			label: "Yes",
		},
		{
			id: "edge-9",
			source: "self",
			target: "billing",
			label: "No",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
