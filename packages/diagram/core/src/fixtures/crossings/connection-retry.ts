/** A connection whose timeout and guarded retry form a two-way link with a choice. From a generated eval sample. */
export default {
	id: "network-connection",
	title: "Network connection",
	initial: "disconnected",
	states: [
		{
			id: "disconnected",
			label: "Disconnected",
		},
		{
			id: "connecting",
			label: "Connecting",
		},
		{
			id: "connected",
			label: "Connected",
			initial: "idle",
		},
		{
			id: "idle",
			label: "Idle",
			parent: "connected",
		},
		{
			id: "streaming",
			label: "Streaming",
			parent: "connected",
		},
		{
			id: "retry_choice",
			kind: "choice",
		},
		{
			id: "failed",
			label: "Failed",
		},
		{
			id: "end",
			kind: "final",
		},
	],
	transitions: [
		{
			id: "transition-1-disconnected-connecting",
			source: "disconnected",
			target: "connecting",
			event: "Connect",
		},
		{
			id: "transition-2-connecting-connected",
			source: "connecting",
			target: "connected",
			event: "handshake ok",
		},
		{
			id: "transition-3-connecting-retry-choice",
			source: "connecting",
			target: "retry_choice",
			event: "timeout",
		},
		{
			id: "transition-4-retry-choice-connecting",
			source: "retry_choice",
			target: "connecting",
			guard: "retries < 3",
			action: "increment retries",
		},
		{
			id: "transition-5-retry-choice-failed",
			source: "retry_choice",
			target: "failed",
			guard: "no retries left",
		},
		{
			id: "transition-6-failed-end",
			source: "failed",
			target: "end",
		},
		{
			id: "transition-7-idle-streaming",
			source: "idle",
			target: "streaming",
			event: "start stream",
		},
		{
			id: "transition-8-streaming-idle",
			source: "streaming",
			target: "idle",
			event: "stop stream",
		},
		{
			id: "transition-9-connected-disconnected",
			source: "connected",
			target: "disconnected",
			event: "Disconnect",
		},
	],
} as const;
