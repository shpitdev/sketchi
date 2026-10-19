/** Hiring across three actors, with a rejection that ends in the candidate's lane and an interview loop. */
export default {
	id: "hiring-lanes",
	title: "Hiring process",
	lanes: [
		{ id: "candidate", label: "Candidate" },
		{ id: "recruiter", label: "Recruiter" },
		{ id: "manager", label: "Hiring manager" },
	],
	nodes: [
		{ id: "apply", label: "Submit application", kind: "start", lane: "candidate" },
		{ id: "screen", label: "Screen the résumé", kind: "process", lane: "recruiter" },
		{ id: "qualified", label: "Qualified?", kind: "decision", lane: "recruiter" },
		{ id: "decline", label: "Receive rejection", kind: "end", lane: "candidate" },
		{ id: "schedule", label: "Schedule interview", kind: "process", lane: "recruiter" },
		{ id: "interview", label: "Attend interview", kind: "process", lane: "candidate" },
		{ id: "assess", label: "Assess the candidate", kind: "process", lane: "manager" },
		{ id: "hire", label: "Hire?", kind: "decision", lane: "manager" },
		{ id: "offer", label: "Send offer", kind: "process", lane: "recruiter" },
		{ id: "accept", label: "Accept offer", kind: "end", lane: "candidate" },
	],
	edges: [
		{ id: "e1", source: "apply", target: "screen" },
		{ id: "e2", source: "screen", target: "qualified" },
		{ id: "e3", source: "qualified", target: "decline", label: "no" },
		{ id: "e4", source: "qualified", target: "schedule", label: "yes" },
		{ id: "e5", source: "schedule", target: "interview" },
		{ id: "e6", source: "interview", target: "assess" },
		{ id: "e7", source: "assess", target: "hire" },
		{ id: "e8", source: "hire", target: "offer", label: "yes" },
		{ id: "e9", source: "hire", target: "schedule", label: "another round" },
		{ id: "e10", source: "offer", target: "accept" },
	],
} as const;
