import { describe, expect, it } from "vitest";

import { nodeLogoIcons } from "./catalog";
import { searchIcons } from "./search";

function slugs(query: string, limit = Number.POSITIVE_INFINITY): string[] {
	return searchIcons(nodeLogoIcons, { limit, query }).map(({ icon }) => icon.slug);
}

/** Product names models search for, and the best mark the catalog has for each. */
export const PRODUCT_NAME_QUERIES: Readonly<Record<string, string>> = {
	"Cloudflare Workers": "cloudflare",
	"cloudflare-workers": "cloudflare",
	"Cloudflare Workers AI": "workersai",
	"Workers AI": "workersai",
	"Cloudflare R2": "cloudflare",
	"Cloudflare Pages": "cloudflare",
	"AWS Lambda": "aws",
	"AWS S3": "aws",
	"Amazon S3": "aws",
	"Amazon DynamoDB": "aws",
	"AWS Bedrock": "bedrock",
	"Amazon Bedrock": "bedrock",
	"Google Cloud Run": "cloud-run",
	"Google Cloud Functions": "cloud-functions",
	"Google Cloud Platform": "googlecloud",
	"Google Kubernetes Engine": "google-kubernetes-engine",
	"Google Pub/Sub": "pubsub",
	"Google Gemini": "gemini",
	"Vercel Edge Functions": "vercel",
	"Vercel AI SDK": "vercel",
	"GitHub Actions": "github",
	"GitHub Codespaces": "github",
	"Azure Functions": "azure",
	"Azure Blob Storage": "azure",
	"Microsoft Azure": "azure",
	"Microsoft Edge": "edge",
	"Supabase Edge Functions": "supabase",
	"Firebase Hosting": "firebase",
	"Netlify Functions": "netlify",
	"Fly.io": "flyio",
	"Fly.io Machines": "flyio",
	"Heroku Postgres": "heroku",
	"MongoDB Atlas": "mongodb",
	"Redis Cloud": "redis",
	"Datadog APM": "datadog",
	"Grafana Cloud": "grafana",
	"Docker Compose": "docker",
	"Terraform Cloud": "terraform",
	"Next.js App Router": "nextjs",
	"OpenAI Assistants API": "openai",
};

/** Generic words that name no product, even where a brand shares one of them. */
export const GENERIC_QUERIES: readonly string[] = [
	"edge functions",
	"serverless functions",
	"background workers",
	"edge workers",
	"actions runner",
	"lambda function",
	"stream processing",
	"render farm",
	"linear regression",
	"storage bucket",
	"payment service",
	"user database",
];

describe("product-name icon search", () => {
	it.each(Object.entries(PRODUCT_NAME_QUERIES))("finds %s as %s", (query, slug) => {
		expect(slugs(query)[0]).toBe(slug);
	});

	it.each(GENERIC_QUERIES)("finds nothing for %s", (query) => {
		expect(slugs(query)).toEqual([]);
	});

	it("keeps exact and alias results for whole-query matches", () => {
		expect(slugs("docker", 1)).toEqual(["docker"]);
		expect(slugs("k8s", 1)).toEqual(["kubernetes"]);
		expect(slugs("psql", 1)).toEqual(["postgresql"]);
		expect(slugs("gcp", 1)).toEqual(["googlecloud"]);
		expect(slugs("cloudflare")).toEqual(["cloudflare"]);
		expect(slugs("github", 1)).toEqual(["github"]);
		expect(slugs("Workers AI")).toEqual(["workersai"]);
		expect(slugs("edge", 1)).toEqual(["edge"]);
		expect(slugs("lambda", 1)).toEqual(["lambda"]);
	});
});
