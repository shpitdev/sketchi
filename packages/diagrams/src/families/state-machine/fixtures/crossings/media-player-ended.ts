/** The media player as another sample drew it. From a generated eval sample. */
export default {
	id: "media-player",
	title: "Media player",
	initial: "stopped",
	states: [
		{
			id: "stopped",
			label: "Stopped",
		},
		{
			id: "active",
			label: "Active",
			initial: "playing",
		},
		{
			id: "playing",
			label: "Playing",
			parent: "active",
		},
		{
			id: "paused",
			label: "Paused",
			parent: "active",
		},
		{
			id: "final",
			kind: "final",
		},
	],
	transitions: [
		{
			id: "transition-1-stopped-active",
			source: "stopped",
			target: "active",
			event: "play",
		},
		{
			id: "transition-2-playing-paused",
			source: "playing",
			target: "paused",
			event: "pause",
		},
		{
			id: "transition-3-paused-playing",
			source: "paused",
			target: "playing",
			event: "resume",
		},
		{
			id: "transition-4-playing-playing",
			source: "playing",
			target: "playing",
			event: "seek",
			action: "jump to position",
		},
		{
			id: "transition-5-active-stopped",
			source: "active",
			target: "stopped",
			event: "stop",
		},
		{
			id: "transition-6-stopped-final",
			source: "stopped",
			target: "final",
			event: "eject",
		},
	],
} as const;
