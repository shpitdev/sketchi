/**
 * Diagram prompts that name no technology. Matching must offer no logo for
 * any of them, and generated diagrams for them must carry none; the matcher
 * tests and the logo evals both run this suite.
 */
export const GENERIC_PROMPTS: readonly string[] = [
	"Payment processing: validate the card, look up the user ID, sync the order to the warehouse, then stream events to analytics.",
	"Webhook handler: verify the payload, run a sanity check, replicate the record, and page through results with cursor pagination.",
	"Bring the team together: a query builder with automatic retries, a magic link sign-in, and a segment for each customer tier.",
	"Render the checkout page, then confirm the cart. Swift delivery follows.",
	"Customer onboarding flow: sign up, verify email, set preferences, invite teammates, then go to the dashboard.",
	"Order approval pipeline: if the order is over $500 a manager must approve, otherwise ship it from storage",
	"Batch received, billing checks it, support reviews operations and networking, then go to review and render the report",
	"Incident response: page the on-call engineer, open a ticket, triage severity, notify stakeholders, and write the postmortem.",
	"Machine learning training loop: load the data, split it into batches, train the model, evaluate on the test set, and deploy if accuracy improves.",
	"Hiring process: post the job, screen resumes, schedule interviews, make an offer, and onboard the new hire.",
	"Support ticket triage: classify the request, route it to the right queue, escalate urgent issues, and close it when resolved.",
	"Sketch a login flow with retries and a fraud check: enter credentials, check the password, and lock the account after three failures.",
	"Data pipeline: ingest raw events, clean and transform them, store them in the warehouse, and publish a daily report.",
	"Content moderation: a post is submitted, an automated filter scores it, a human reviews flagged items, then it is published or removed.",
	"Payment Processing Flow\nLook Up User ID\nSync Order\nStream Events",
	"The release process: build, test, deploy to staging, run smoke tests, and promote to production.",
	"Inventory sync between the store and the warehouse with conflict resolution and an audit log.",
	"Real-time chat: messages stream through a gateway, get stored, and fan out to connected clients over web sockets.",
	"Patient intake at a clinic: check in, verify insurance, triage, see the doctor, and schedule a follow-up.",
	"API request lifecycle: authenticate, rate limit, validate input, call the service, cache the response, and return JSON.",
	"A serverless function receives a webhook, writes to the datastore, and publishes to pubsub.",
	"A dashboard for observability: metrics, logs, traces, and alerts in one place.",
	"Plan a trip: choose a destination, book flights and a hotel, pack, and travel.",
	"Map the data flow for an AI chat app with streaming responses.",
	"Diagram a CI/CD pipeline from commit to production.",
];
