// Maintained State crossing fixtures are decoded once; invalid fixture data is a startup defect.
import { Result } from "effect";
import { parseStateMachineDiagram, stateMachineDiagramType } from "./document.js";
import connectionRetry from "./fixtures/crossings/connection-retry.js";
import connectionRetryDisconnect from "./fixtures/crossings/connection-retry-disconnect.js";
import mediaPlayer from "./fixtures/crossings/media-player.js";
import mediaPlayerEnded from "./fixtures/crossings/media-player-ended.js";
import namedFinalRetry from "./fixtures/crossings/named-final-retry.js";
import orderLifecycle from "./fixtures/crossings/order-lifecycle.js";
import orderLifecycleEnded from "./fixtures/crossings/order-lifecycle-ended.js";

function stateMachine(fixture: object) {
	return parseStateMachineDiagram({ ...fixture, type: stateMachineDiagramType }).pipe(
		Result.getOrThrow,
	);
}

/**
 * Generated state machines whose layouts drew avoidable crossings, a guard
 * label between two lines, a return label nearer another line than its own or
 * a label moved out past the drawing, each laid out in whichever direction
 * reads better.
 */
export const crossingStateMachines = {
	"media-player": stateMachine(mediaPlayer),
	"media-player-ended": stateMachine(mediaPlayerEnded),
	"connection-retry": stateMachine(connectionRetry),
	"connection-retry-disconnect": stateMachine(connectionRetryDisconnect),
	"order-lifecycle": stateMachine(orderLifecycle),
	"order-lifecycle-ended": stateMachine(orderLifecycleEnded),
	"named-final-retry": stateMachine(namedFinalRetry),
};
