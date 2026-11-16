// Maintained fixtures are trusted; an invalid fixture is a startup defect.
import { Result } from "effect";
import { parseSequenceDiagram, sequenceDiagramType } from "./document";
export const sequenceFixture = parseSequenceDiagram({
	id: "checkout-sequence",
	title: "Checkout sequence",
	type: sequenceDiagramType,
	participants: [
		{ id: "customer", label: "Customer" },
		{ id: "store", label: "Store" },
		{ id: "payments", label: "Payments" },
	],
	messages: [
		{ id: "checkout", source: "customer", target: "store", label: "Submit checkout" },
		{ id: "charge", source: "store", target: "payments", label: "Charge card" },
		{
			id: "charged",
			source: "payments",
			target: "store",
			label: "Payment approved",
			type: "return",
		},
		{
			id: "receipt",
			source: "store",
			target: "customer",
			label: "Order receipt",
			type: "return",
		},
	],
}).pipe(Result.getOrThrow);

/** A request path with a nested call, a fire-and-forget event, and returns. */
export const apiRequestSequence = parseSequenceDiagram({
	id: "api-request-sequence",
	title: "API request with cache miss",
	type: sequenceDiagramType,
	participants: [
		{ id: "browser", label: "Browser" },
		{ id: "api", label: "API Worker" },
		{ id: "cache", label: "Cache" },
		{ id: "database", label: "Database" },
		{ id: "analytics", label: "Analytics" },
	],
	messages: [
		{ id: "request", source: "browser", target: "api", label: "GET /orders" },
		{ id: "lookup", source: "api", target: "cache", label: "Look up orders" },
		{ id: "miss", source: "cache", target: "api", label: "Cache miss", type: "return" },
		{ id: "query", source: "api", target: "database", label: "Query orders" },
		{ id: "rows", source: "database", target: "api", label: "Order rows", type: "return" },
		{ id: "track", source: "api", target: "analytics", label: "Track request" },
		{ id: "response", source: "api", target: "browser", label: "200 OK", type: "return" },
	],
}).pipe(Result.getOrThrow);

/** A deploy webhook whose participants carry catalog logos. */
export const deployWebhookLogoSequence = parseSequenceDiagram({
	id: "deploy-webhook-logos",
	title: "Deploy webhook",
	type: sequenceDiagramType,
	participants: [
		{ id: "developer", label: "Developer" },
		{ id: "github", label: "GitHub", icon: { slug: "github" } },
		{ id: "worker", label: "Cloudflare Worker", icon: { slug: "cloudflare" } },
		{ id: "docker", label: "Docker build", icon: { slug: "docker" } },
	],
	messages: [
		{ id: "push", source: "developer", target: "github", label: "git push" },
		{ id: "webhook", source: "github", target: "worker", label: "Push webhook" },
		{ id: "build", source: "worker", target: "docker", label: "Build image" },
		{ id: "digest", source: "docker", target: "worker", label: "Image digest", type: "return" },
		{ id: "accepted", source: "worker", target: "github", label: "202 Accepted", type: "return" },
	],
}).pipe(Result.getOrThrow);

/** Self-messages: consecutive checks inside an active bar, and a retry on an idle lifeline. */
export const selfMessageSequence = parseSequenceDiagram({
	id: "self-message-sequence",
	title: "Login with credential checks",
	type: sequenceDiagramType,
	participants: [
		{ id: "browser", label: "Browser" },
		{ id: "idp", label: "Identity Provider" },
		{ id: "users", label: "User Directory" },
	],
	messages: [
		{ id: "sign-in", source: "browser", target: "idp", label: "Sign in" },
		{ id: "validate", source: "idp", target: "idp", label: "Validate credentials" },
		{
			id: "mfa",
			source: "idp",
			target: "idp",
			label: "Check the one-time code against the enrolled authenticator",
		},
		{ id: "lookup", source: "idp", target: "users", label: "Look up user" },
		{ id: "profile", source: "users", target: "idp", label: "Profile", type: "return" },
		{ id: "session", source: "idp", target: "browser", label: "Session", type: "return" },
		{ id: "refresh", source: "browser", target: "browser", label: "Refresh the page" },
	],
}).pipe(Result.getOrThrow);
