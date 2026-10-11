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
		logos: [{ name: "Oauth", slug: "oauth" }],
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
		id: "deploy-webhook-logos-sequence",
		title: "Deploy webhook with logos",
		difficulty: "standard",
		tags: ["sequence", "logos", "webhook"],
		description:
			"Named technologies should appear as logos on the participants that are those technologies, and nowhere else.",
		prompt:
			"Sequence diagram of a deploy webhook. A developer pushes a commit to GitHub. GitHub sends a push webhook to a Cloudflare Worker. The Worker asks Docker to build the image and gets the image digest back, then answers the GitHub webhook with 202 Accepted.",
		logos: [
			{ name: "Github", slug: "github" },
			{ aliases: ["Cloudflare"], name: "Cloudflare", slug: "cloudflare" },
			{ name: "Docker", slug: "docker" },
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
] satisfies readonly SequenceScenarioDefinition[];

export const sequenceScenarios: readonly SequenceScenario[] =
	sequenceScenarioDefinitions.map(defineSequenceScenario);

export function getSequenceScenario(id: string): SequenceScenario {
	const scenario = sequenceScenarios.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`Unknown sequence scenario "${id}".`);
	return scenario;
}
