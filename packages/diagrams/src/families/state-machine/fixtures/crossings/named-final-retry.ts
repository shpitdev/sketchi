/** Exact round-14 Sonnet capture: naming Failed exposed crossing paired retry lanes. */
export default {
	id: "network-connection",
	title: "Network Connection",
	initial: "Disconnected",
	states: [
		{
			id: "Disconnected",
			label: "Disconnected",
		},
		{
			id: "Connecting",
			label: "Connecting",
		},
		{
			id: "Connected",
			label: "Connected",
			initial: "Idle",
		},
		{
			id: "Idle",
			label: "Idle",
			parent: "Connected",
		},
		{
			id: "Streaming",
			label: "Streaming",
			parent: "Connected",
		},
		{
			id: "RetryCheck",
			label: "Retry check",
			kind: "choice",
		},
		{
			id: "Failed",
			label: "Failed",
			kind: "final",
		},
	],
	transitions: [
		{
			id: "transition-1-disconnected-connecting",
			source: "Disconnected",
			target: "Connecting",
			event: "Connect",
		},
		{
			id: "transition-2-connecting-connected",
			source: "Connecting",
			target: "Connected",
			event: "handshake ok",
		},
		{
			id: "transition-3-connecting-retrycheck",
			source: "Connecting",
			target: "RetryCheck",
			event: "timeout",
		},
		{
			id: "transition-4-retrycheck-connecting",
			source: "RetryCheck",
			target: "Connecting",
			guard: "retries < 3",
			action: "increment retries",
		},
		{
			id: "transition-5-retrycheck-failed",
			source: "RetryCheck",
			target: "Failed",
			guard: "no retries left",
		},
		{
			id: "transition-6-idle-streaming",
			source: "Idle",
			target: "Streaming",
			event: "start stream",
		},
		{
			id: "transition-7-streaming-idle",
			source: "Streaming",
			target: "Idle",
			event: "stop stream",
		},
		{
			id: "transition-8-connected-disconnected",
			source: "Connected",
			target: "Disconnected",
			event: "Disconnect",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
	type: "state-machine",
} as const;
