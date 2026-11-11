import {
	type SequenceDiagram,
	type SequenceMessageType,
	parseSequenceDiagram,
} from "@sketchi/diagram-core";

import type { DiagramScenarioDifficulty, DiagramScenarioLogo } from "./scenarios.js";

/**
 * One message the model must draw. Participants and labels match when the
 * generated text contains any listed alternative, case-insensitively, so the
 * check scores structure rather than exact wording.
 */
export interface SequenceScenarioMessage {
	readonly label?: readonly string[];
	/** The message must be a self-message: its source participant is its target. */
	readonly self?: true;
	readonly source: readonly string[];
	readonly target: readonly string[];
	readonly type?: SequenceMessageType;
}

export interface SequenceScenarioAssertions {
	/** Calls the diagram must answer with a matching return (activation spans). */
	readonly minAnsweredCalls: number;
	readonly minMessageCount: number;
	readonly minParticipantCount: number;
	/** Messages that must appear, in this chronological order. */
	readonly orderedMessages: readonly SequenceScenarioMessage[];
	/** Logos the expected diagram draws; generated diagrams must include them. */
	readonly requiredIconSlugs: readonly string[];
	/** Participants that must appear; each entry lists label alternatives. */
	readonly requiredParticipants: readonly (readonly string[])[];
	/** Fire-and-forget calls that must appear and that no return may answer. */
	readonly unansweredCalls?: readonly SequenceScenarioMessage[];
}

export interface SequenceScenario {
	readonly assertions: SequenceScenarioAssertions;
	readonly description: string;
	readonly diagramType: "sequence";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: SequenceDiagram;
	readonly id: string;
	/** Logos offered to generation; generated icons must stay within them. */
	readonly logos: readonly DiagramScenarioLogo[];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

type ParticipantDefinition = readonly [id: string, label: string, icon?: string];
type MessageDefinition = readonly [
	id: string,
	source: string,
	target: string,
	label: string,
	type?: SequenceMessageType,
];

interface SequenceScenarioDefinition extends Omit<
	SequenceScenario,
	"assertions" | "diagramType" | "expectedDiagram" | "logos"
> {
	readonly assertions: Omit<SequenceScenarioAssertions, "requiredIconSlugs">;
	readonly logos?: readonly DiagramScenarioLogo[];
	readonly messages: readonly MessageDefinition[];
	readonly participants: readonly ParticipantDefinition[];
}

function defineSequenceScenario(definition: SequenceScenarioDefinition): SequenceScenario {
	const { assertions, messages, participants, logos, ...scenario } = definition;
	const offered = new Set((logos ?? []).map((logo) => logo.slug));
	for (const [id, , icon] of participants) {
		if (icon && !offered.has(icon)) {
			throw new Error(
				`Scenario "${definition.id}" draws logo "${icon}" on "${id}" that its prompt does not name.`,
			);
		}
	}
	return {
		...scenario,
		assertions: {
			...assertions,
			requiredIconSlugs: participants.flatMap(([, , icon]) => (icon ? [icon] : [])),
		},
		diagramType: "sequence",
		logos: [...(logos ?? [])],
		expectedDiagram: parseSequenceDiagram({
			id: definition.id,
			title: definition.title,
			type: "sequence",
			participants: participants.map(([id, label, icon]) => ({
				id,
				label,
				...(icon ? { icon: { slug: icon } } : {}),
			})),
			messages: messages.map(([id, source, target, label, type]) => ({
				id,
				source,
				target,
				label,
				...(type ? { type } : {}),
			})),
		}),
	};
}

const sequenceScenarioDefinitions = [
	{
		id: "checkout-payment-sequence",
		title: "Checkout payment sequence",
		difficulty: "smoke",
		tags: ["sequence", "request-response"],
		description:
			"Two nested request/response pairs: the store answers the browser only after the payment service answers the store.",
		prompt:
			"Draw a sequence diagram of a checkout. The browser submits the order to the Store API. The Store API asks the Payment Service to charge the card. The Payment Service returns the approval to the Store API, and the Store API then returns the order confirmation to the browser.",
		participants: [
			["browser", "Browser"],
			["store-api", "Store API"],
			["payment-service", "Payment Service"],
		],
		messages: [
			["submit-order", "browser", "store-api", "Submit order"],
			["charge-card", "store-api", "payment-service", "Charge card"],
			["approved", "payment-service", "store-api", "Payment approved", "return"],
			["confirmation", "store-api", "browser", "Order confirmation", "return"],
		],
		assertions: {
			minAnsweredCalls: 2,
			minMessageCount: 4,
			minParticipantCount: 3,
			requiredParticipants: [["browser"], ["store"], ["payment"]],
			orderedMessages: [
				{ source: ["browser"], target: ["store"], label: ["order", "checkout"] },
				{ source: ["store"], target: ["payment"], label: ["charge", "pay", "authoriz"] },
				{
					source: ["payment"],
					target: ["store"],
					label: ["approv", "success", "charged", "ok"],
					type: "return",
				},
				{
					source: ["store"],
					target: ["browser"],
					label: ["confirm", "receipt", "order"],
					type: "return",
				},
			],
		},
	},
	{
		id: "api-cache-miss-sequence",
		title: "API request with a cache miss",
		difficulty: "standard",
		tags: ["sequence", "cache", "fire-and-forget"],
		description:
			"A cache miss falls through to the database, and an analytics event is sent without waiting for a reply.",
		prompt:
			"Sequence diagram: the Browser sends GET /orders to the API Worker. The API Worker looks the orders up in the Cache and gets a cache miss back. It then queries the Database, which returns the order rows. The API Worker sends a usage event to Analytics without waiting for a reply, and finally returns 200 OK with the orders to the Browser.",
		participants: [
			["browser", "Browser"],
			["api", "API Worker"],
			["cache", "Cache"],
			["database", "Database"],
			["analytics", "Analytics"],
		],
		messages: [
			["get-orders", "browser", "api", "GET /orders"],
			["lookup", "api", "cache", "Look up orders"],
			["miss", "cache", "api", "Cache miss", "return"],
			["query", "api", "database", "Query orders"],
			["rows", "database", "api", "Order rows", "return"],
			["usage", "api", "analytics", "Usage event"],
			["ok", "api", "browser", "200 OK with orders", "return"],
		],
		assertions: {
			minAnsweredCalls: 3,
			minMessageCount: 7,
			minParticipantCount: 5,
			requiredParticipants: [["browser"], ["api"], ["cache"], ["database"], ["analytics"]],
			unansweredCalls: [{ source: ["api"], target: ["analytics"] }],
			orderedMessages: [
				{ source: ["browser"], target: ["api"], label: ["orders", "get"] },
				{ source: ["api"], target: ["cache"] },
				{ source: ["cache"], target: ["api"], label: ["miss"], type: "return" },
				{ source: ["api"], target: ["database"] },
				{ source: ["database"], target: ["api"], type: "return" },
				{ source: ["api"], target: ["analytics"], type: "message" },
				{ source: ["api"], target: ["browser"], label: ["200", "ok", "orders"], type: "return" },
			],
		},
	},
	{
		id: "oauth-authorization-code-sequence",
		title: "OAuth authorization code login",
		difficulty: "standard",
		tags: ["sequence", "auth", "redirects"],
		logos: [{ aliases: ["OAuth"], collection: "auth-identity", name: "OAuth", slug: "oauth" }],
		description:
			"Redirect-based login where the back-channel token exchange must happen before the session is returned.",
		prompt:
			"Sequence diagram of an OAuth authorization code login. The Browser asks the Web App to sign in and is redirected to the Identity Provider. The Browser sends the authorization request to the Identity Provider, the user signs in, and the Identity Provider redirects the Browser back to the Web App with an authorization code. The Web App exchanges the code for tokens with the Identity Provider, receives the tokens, and returns a signed-in session to the Browser.",
		participants: [
			["browser", "Browser"],
			["web-app", "Web App"],
			["idp", "Identity Provider"],
		],
		messages: [
			["sign-in", "browser", "web-app", "Sign in"],
			["redirect-idp", "web-app", "browser", "Redirect to provider", "return"],
			["authorize", "browser", "idp", "Authorization request"],
			["code", "idp", "browser", "Redirect with code", "return"],
			["callback", "browser", "web-app", "Callback with code"],
			["exchange", "web-app", "idp", "Exchange code for tokens"],
			["tokens", "idp", "web-app", "Access and ID tokens", "return"],
			["session", "web-app", "browser", "Signed-in session", "return"],
		],
		assertions: {
			minAnsweredCalls: 3,
			minMessageCount: 6,
			minParticipantCount: 3,
			requiredParticipants: [["browser"], ["web app", "app"], ["identity", "provider", "idp"]],
			orderedMessages: [
				{ source: ["browser"], target: ["identity", "provider", "idp"] },
				{ source: ["identity", "provider", "idp"], target: ["browser"], label: ["code"] },
				{ source: ["app"], target: ["identity", "provider", "idp"], label: ["token", "code"] },
				{ source: ["identity", "provider", "idp"], target: ["app"], label: ["token"] },
				{ source: ["app"], target: ["browser"], label: ["session", "signed", "cookie"] },
			],
		},
	},
	{
		id: "payment-webhook-reentrant-sequence",
		title: "Payment webhook with verification",
		difficulty: "challenge",
		tags: ["sequence", "webhook", "callback"],
		description:
			"The provider calls back into the service, which calls the provider again before answering the callback.",
		prompt:
			"Sequence diagram for a card payment webhook. The Checkout Service asks the Payment Provider to create a payment and gets the payment id back. Later the Payment Provider calls the Checkout Service's webhook with a payment succeeded event. While handling that webhook, the Checkout Service asks the Payment Provider to verify the event and gets the verified event back, then answers the webhook with 200 OK. Finally the Checkout Service tells the Fulfillment Service to ship the order.",
		participants: [
			["checkout", "Checkout Service"],
			["provider", "Payment Provider"],
			["fulfillment", "Fulfillment Service"],
		],
		messages: [
			["create", "checkout", "provider", "Create payment"],
			["payment-id", "provider", "checkout", "Payment id", "return"],
			["webhook", "provider", "checkout", "Payment succeeded webhook"],
			["verify", "checkout", "provider", "Verify event"],
			["verified", "provider", "checkout", "Verified event", "return"],
			["ack", "checkout", "provider", "200 OK", "return"],
			["ship", "checkout", "fulfillment", "Ship order"],
		],
		assertions: {
			minAnsweredCalls: 3,
			minMessageCount: 7,
			minParticipantCount: 3,
			requiredParticipants: [["checkout"], ["payment", "provider"], ["fulfillment"]],
			orderedMessages: [
				{ source: ["checkout"], target: ["payment", "provider"], label: ["create", "payment"] },
				{ source: ["payment", "provider"], target: ["checkout"], label: ["webhook", "succeeded"] },
				{ source: ["checkout"], target: ["payment", "provider"], label: ["verif"] },
				{
					source: ["payment", "provider"],
					target: ["checkout"],
					label: ["verif"],
					type: "return",
				},
				{
					source: ["checkout"],
					target: ["payment", "provider"],
					label: ["200", "ok", "ack"],
					type: "return",
				},
				{ source: ["checkout"], target: ["fulfillment"], label: ["ship", "fulfil"] },
			],
		},
	},
	{
		id: "password-login-self-check-sequence",
		title: "Password login with a credential check",
		difficulty: "standard",
		tags: ["sequence", "auth", "self-message"],
		description:
			"The auth service checks the credentials and signs the token itself, so both steps are self-messages inside its answer to the browser.",
		prompt:
			"Sequence diagram of a password login. The Browser submits the username and password to the Auth Service. The Auth Service validates the credentials itself, then asks the User Store for the user record and gets the record back. The Auth Service signs a session token itself and returns the session cookie to the Browser.",
		participants: [
			["browser", "Browser"],
			["auth", "Auth Service"],
			["users", "User Store"],
		],
		messages: [
			["submit", "browser", "auth", "Submit credentials"],
			["validate", "auth", "auth", "Validate credentials"],
			["load-user", "auth", "users", "Load user record"],
			["user-record", "users", "auth", "User record", "return"],
			["sign-token", "auth", "auth", "Sign session token"],
			["session", "auth", "browser", "Session cookie", "return"],
		],
		assertions: {
			minAnsweredCalls: 2,
			minMessageCount: 6,
			minParticipantCount: 3,
			requiredParticipants: [["browser"], ["auth"], ["user"]],
			orderedMessages: [
				{
					source: ["browser"],
					target: ["auth"],
					label: ["credential", "password", "log", "sign", "submit"],
				},
				{ source: ["auth"], target: ["auth"], self: true, label: ["valid", "verif", "check"] },
				{ source: ["auth"], target: ["user"], label: ["user", "record", "load", "fetch"] },
				{ source: ["user"], target: ["auth"], type: "return" },
				{ source: ["auth"], target: ["auth"], self: true, label: ["token", "sign"] },
				{
					source: ["auth"],
					target: ["browser"],
					label: ["session", "cookie"],
					type: "return",
				},
			],
		},
	},
	{
		id: "deploy-webhook-logos-sequence",
		title: "Deploy webhook with logos",
		difficulty: "standard",
		tags: ["sequence", "logos", "webhook"],
		description:
			"Named technologies should appear as logos on the participants that are those technologies, and nowhere else.",
		prompt:
			"Sequence diagram of a deploy webhook. A developer pushes a commit to GitHub. GitHub sends a push webhook to a Cloudflare Worker. The Worker asks Docker to build the image and gets the image digest back, then answers the GitHub webhook with 202 Accepted.",
		logos: [
			{ aliases: ["GitHub"], collection: "devtools-ci", name: "GitHub", slug: "github" },
			{
				aliases: ["Cloudflare"],
				collection: "cloud-vendors",
				name: "Cloudflare",
				slug: "cloudflare",
			},
			{ collection: "devtools-ci", name: "Docker", slug: "docker" },
		],
		participants: [
			["developer", "Developer"],
			["github", "GitHub", "github"],
			["worker", "Cloudflare Worker", "cloudflare"],
			["docker", "Docker", "docker"],
		],
		messages: [
			["push", "developer", "github", "Push commit"],
			["webhook", "github", "worker", "Push webhook"],
			["build", "worker", "docker", "Build image"],
			["digest", "docker", "worker", "Image digest", "return"],
			["accepted", "worker", "github", "202 Accepted", "return"],
		],
		assertions: {
			minAnsweredCalls: 2,
			minMessageCount: 5,
			minParticipantCount: 4,
			requiredParticipants: [["developer"], ["github"], ["worker", "cloudflare"], ["docker"]],
			orderedMessages: [
				{ source: ["developer"], target: ["github"], label: ["push", "commit"] },
				{ source: ["github"], target: ["worker", "cloudflare"], label: ["webhook", "push"] },
				{ source: ["worker", "cloudflare"], target: ["docker"], label: ["build"] },
				{
					source: ["docker"],
					target: ["worker", "cloudflare"],
					label: ["digest", "image"],
					type: "return",
				},
				{
					source: ["worker", "cloudflare"],
					target: ["github"],
					label: ["202", "accepted"],
					type: "return",
				},
			],
		},
	},
	{
		id: "ride-booking-sequence-large",
		title: "Ride booking",
		difficulty: "challenge",
		tags: ["sequence", "large", "request-response", "fire-and-forget", "real-voice"],
		description:
			"Forty messages across ten participants: nested calls answered by their returns, three calls from the driver app and five notifications sent without waiting for a reply.",
		prompt:
			"sequence diagram of booking a ride, one line per message, --> is a reply\n\n1. Rider App -> API Gateway: Request ride\n2. API Gateway -> Auth Service: Validate token\n3. Auth Service --> API Gateway: Token valid\n4. API Gateway -> Trip Service: Create trip\n5. Trip Service -> Pricing Service: Get fare estimate\n6. Pricing Service -> Database: Load surge zones\n7. Database --> Pricing Service: Surge zones\n8. Pricing Service --> Trip Service: Fare estimate\n9. Trip Service -> Database: Save trip request\n10. Database --> Trip Service: Trip saved\n11. Trip Service --> API Gateway: Trip created\n12. API Gateway --> Rider App: Fare and trip id\n13. Rider App -> API Gateway: Confirm booking\n14. API Gateway -> Trip Service: Confirm trip\n15. Trip Service -> Payment Service: Authorize card\n16. Payment Service --> Trip Service: Authorization hold\n17. Trip Service -> Dispatch Service: Find driver\n18. Dispatch Service -> Database: Query nearby drivers\n19. Database --> Dispatch Service: Driver list\n20. Dispatch Service -> Driver App: Offer trip\n21. Driver App --> Dispatch Service: Trip accepted\n22. Dispatch Service --> Trip Service: Driver assigned\n23. Trip Service -> Notification Service: Send driver details (no reply)\n24. Notification Service -> Rider App: Push driver arriving (no reply)\n25. Trip Service --> API Gateway: Booking confirmed\n26. API Gateway --> Rider App: Driver on the way\n27. Driver App -> Trip Service: Arrived at pickup\n28. Trip Service -> Notification Service: Notify rider of arrival (no reply)\n29. Driver App -> Trip Service: Start trip\n30. Trip Service -> Database: Record trip start\n31. Database --> Trip Service: Start recorded\n32. Driver App -> Trip Service: End trip\n33. Trip Service -> Pricing Service: Calculate final fare\n34. Pricing Service --> Trip Service: Final fare\n35. Trip Service -> Payment Service: Capture payment\n36. Payment Service --> Trip Service: Payment captured\n37. Trip Service -> Database: Close trip\n38. Database --> Trip Service: Trip closed\n39. Trip Service -> Notification Service: Send receipt (no reply)\n40. Notification Service -> Rider App: Email receipt (no reply)",
		participants: [
			["rider", "Rider App"],
			["gateway", "API Gateway"],
			["auth", "Auth Service"],
			["trip", "Trip Service"],
			["pricing", "Pricing Service"],
			["dispatch", "Dispatch Service"],
			["driver", "Driver App"],
			["payment", "Payment Service"],
			["notify", "Notification Service"],
			["db", "Database"],
		],
		messages: [
			["m01-request-ride", "rider", "gateway", "Request ride"],
			["m02-validate-token", "gateway", "auth", "Validate token"],
			["m03-token-valid", "auth", "gateway", "Token valid", "return"],
			["m04-create-trip", "gateway", "trip", "Create trip"],
			["m05-get-fare-estimate", "trip", "pricing", "Get fare estimate"],
			["m06-load-surge-zones", "pricing", "db", "Load surge zones"],
			["m07-surge-zones", "db", "pricing", "Surge zones", "return"],
			["m08-fare-estimate", "pricing", "trip", "Fare estimate", "return"],
			["m09-save-trip-request", "trip", "db", "Save trip request"],
			["m10-trip-saved", "db", "trip", "Trip saved", "return"],
			["m11-trip-created", "trip", "gateway", "Trip created", "return"],
			["m12-fare-and-trip-id", "gateway", "rider", "Fare and trip id", "return"],
			["m13-confirm-booking", "rider", "gateway", "Confirm booking"],
			["m14-confirm-trip", "gateway", "trip", "Confirm trip"],
			["m15-authorize-card", "trip", "payment", "Authorize card"],
			["m16-authorization-hold", "payment", "trip", "Authorization hold", "return"],
			["m17-find-driver", "trip", "dispatch", "Find driver"],
			["m18-query-nearby-drivers", "dispatch", "db", "Query nearby drivers"],
			["m19-driver-list", "db", "dispatch", "Driver list", "return"],
			["m20-offer-trip", "dispatch", "driver", "Offer trip"],
			["m21-trip-accepted", "driver", "dispatch", "Trip accepted", "return"],
			["m22-driver-assigned", "dispatch", "trip", "Driver assigned", "return"],
			["m23-send-driver-details", "trip", "notify", "Send driver details"],
			["m24-push-driver-arriving", "notify", "rider", "Push driver arriving"],
			["m25-booking-confirmed", "trip", "gateway", "Booking confirmed", "return"],
			["m26-driver-on-the-way", "gateway", "rider", "Driver on the way", "return"],
			["m27-arrived-at-pickup", "driver", "trip", "Arrived at pickup"],
			["m28-notify-rider-of-arrival", "trip", "notify", "Notify rider of arrival"],
			["m29-start-trip", "driver", "trip", "Start trip"],
			["m30-record-trip-start", "trip", "db", "Record trip start"],
			["m31-start-recorded", "db", "trip", "Start recorded", "return"],
			["m32-end-trip", "driver", "trip", "End trip"],
			["m33-calculate-final-fare", "trip", "pricing", "Calculate final fare"],
			["m34-final-fare", "pricing", "trip", "Final fare", "return"],
			["m35-capture-payment", "trip", "payment", "Capture payment"],
			["m36-payment-captured", "payment", "trip", "Payment captured", "return"],
			["m37-close-trip", "trip", "db", "Close trip"],
			["m38-trip-closed", "db", "trip", "Trip closed", "return"],
			["m39-send-receipt", "trip", "notify", "Send receipt"],
			["m40-email-receipt", "notify", "rider", "Email receipt"],
		],
		assertions: {
			minAnsweredCalls: 16,
			minMessageCount: 40,
			minParticipantCount: 10,
			requiredParticipants: [
				["rider"],
				["gateway"],
				["auth"],
				["trip"],
				["pricing", "price"],
				["dispatch"],
				["driver"],
				["payment"],
				["notification"],
				["database"],
			],
			unansweredCalls: [
				{ source: ["trip"], target: ["notification"], label: ["details"] },
				{ source: ["notification"], target: ["rider"], label: ["arriving", "push"] },
				{ source: ["trip"], target: ["notification"], label: ["arrival"] },
				{ source: ["trip"], target: ["notification"], label: ["receipt"] },
				{ source: ["notification"], target: ["rider"], label: ["receipt", "email"] },
			],
			orderedMessages: [
				{ source: ["rider"], target: ["gateway"], label: ["request", "ride"] },
				{ source: ["gateway"], target: ["auth"], label: ["validat", "token"] },
				{ source: ["auth"], target: ["gateway"], label: ["valid", "token"], type: "return" },
				{ source: ["gateway"], target: ["trip"], label: ["create"] },
				{ source: ["trip"], target: ["pricing", "price"], label: ["estimate", "fare"] },
				{ source: ["pricing", "price"], target: ["database"], label: ["surge"] },
				{
					source: ["database"],
					target: ["pricing", "price"],
					label: ["surge", "zone"],
					type: "return",
				},
				{
					source: ["pricing", "price"],
					target: ["trip"],
					label: ["estimate", "fare"],
					type: "return",
				},
				{ source: ["trip"], target: ["database"], label: ["save"] },
				{ source: ["database"], target: ["trip"], label: ["saved"], type: "return" },
				{ source: ["trip"], target: ["gateway"], label: ["created"], type: "return" },
				{ source: ["gateway"], target: ["rider"], label: ["fare", "trip id"], type: "return" },
				{ source: ["rider"], target: ["gateway"], label: ["confirm"] },
				{ source: ["gateway"], target: ["trip"], label: ["confirm"] },
				{ source: ["trip"], target: ["payment"], label: ["authoriz"] },
				{ source: ["payment"], target: ["trip"], label: ["authoriz", "hold"], type: "return" },
				{ source: ["trip"], target: ["dispatch"], label: ["find"] },
				{ source: ["dispatch"], target: ["database"], label: ["nearby", "quer"] },
				{ source: ["database"], target: ["dispatch"], label: ["list", "driver"], type: "return" },
				{ source: ["dispatch"], target: ["driver"], label: ["offer"] },
				{ source: ["driver"], target: ["dispatch"], label: ["accept"], type: "return" },
				{ source: ["dispatch"], target: ["trip"], label: ["assign"], type: "return" },
				{ source: ["trip"], target: ["notification"], label: ["details"] },
				{ source: ["notification"], target: ["rider"], label: ["arriving", "push"] },
				{ source: ["trip"], target: ["gateway"], label: ["confirm"], type: "return" },
				{ source: ["gateway"], target: ["rider"], label: ["on the way"], type: "return" },
				{ source: ["driver"], target: ["trip"], label: ["arrived", "pickup"] },
				{ source: ["trip"], target: ["notification"], label: ["arrival"] },
				{ source: ["driver"], target: ["trip"], label: ["start"] },
				{ source: ["trip"], target: ["database"], label: ["record"] },
				{ source: ["database"], target: ["trip"], label: ["recorded"], type: "return" },
				{ source: ["driver"], target: ["trip"], label: ["end"] },
				{ source: ["trip"], target: ["pricing", "price"], label: ["calculat", "final"] },
				{ source: ["pricing", "price"], target: ["trip"], label: ["final"], type: "return" },
				{ source: ["trip"], target: ["payment"], label: ["capture"] },
				{ source: ["payment"], target: ["trip"], label: ["captured"], type: "return" },
				{ source: ["trip"], target: ["database"], label: ["close"] },
				{ source: ["database"], target: ["trip"], label: ["closed"], type: "return" },
				{ source: ["trip"], target: ["notification"], label: ["receipt"] },
				{ source: ["notification"], target: ["rider"], label: ["receipt", "email"] },
			],
		},
	},
] satisfies readonly SequenceScenarioDefinition[];

export const sequenceScenarios: readonly SequenceScenario[] =
	sequenceScenarioDefinitions.map(defineSequenceScenario);

export function getSequenceScenario(id: string): SequenceScenario {
	const scenario = sequenceScenarios.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`Unknown sequence scenario "${id}".`);
	return scenario;
}
