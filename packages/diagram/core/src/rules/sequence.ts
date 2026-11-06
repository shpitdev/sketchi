import { SEQUENCE_MAX_MESSAGES, SEQUENCE_MAX_PARTICIPANTS } from "../types/sequence.js";
import type { RuleSource } from "./source.js";

/** How a request becomes a sequence diagram; see FLOWCHART_RULES. */
export const SEQUENCE_RULES = {
	order: "Participant order is preserved left-to-right. Message order is preserved top-to-bottom.",
	messageTypes:
		'Use message type "message" for calls and "return" for responses; dashed style is appropriate for responses.',
	replies: (source: RuleSource) =>
		`Every reply ${source} states, including a redirect back to the caller, is its own type: "return" message from the callee back to its caller; it answers the latest open call between them.`,
	fireAndForget: "Leave fire-and-forget events unanswered.",
	keepOrder: (source: RuleSource) =>
		`Keep ${source}'s message order exactly, even where another order seems more natural.`,
	activation:
		'A message with type "return" from the callee back to its caller answers the latest open call between them; Sketchi draws the callee\'s activation bar from that call to its return, nesting re-entrant calls. Calls nobody answers draw no bar.',
	selfStep:
		"A participant's own step (validating, retrying) is a self-message with source = target.",
	selfMessage:
		"Every message source and target must reference a declared participant id. A self-message (source equals target) draws as a loop on that participant's lifeline; a self-call returns into a short nested activation bar, and self-messages never answer or open a call between participants.",
	/** A clause: each surface frames the limit in its own sentence. */
	limits: `at most ${SEQUENCE_MAX_PARTICIPANTS} participants and ${SEQUENCE_MAX_MESSAGES} messages`,
} as const;
