/**
 * Exact Sonnet capture from the label-detach A/B: the Disconnect label sat above
 * its exit from the Connected frame, its own line nearest, but the frame 10 px
 * away made it read as ambiguous, and it slid out past its return run, widening
 * the drawing.
 */
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
			label: "Retry?",
			kind: "choice",
		},
		{
			id: "Failed",
			label: "Failed",
		},
		{
			id: "End",
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
			id: "transition-6-failed-end",
			source: "Failed",
			target: "End",
		},
		{
			id: "transition-7-idle-streaming",
			source: "Idle",
			target: "Streaming",
			event: "start stream",
		},
		{
			id: "transition-8-streaming-idle",
			source: "Streaming",
			target: "Idle",
			event: "stop stream",
		},
		{
			id: "transition-9-connected-disconnected",
			source: "Connected",
			target: "Disconnected",
			event: "Disconnect",
		},
	],
	style: {
		accentColor: "#8f707f",
		backgroundColor: "#fffdf8",
	},
} as const;
