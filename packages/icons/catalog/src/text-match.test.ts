import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { iconManifest, nodeLogoIcons } from "./catalog";
import { catalogCommonWords, loadCommonEnglishWords } from "./common-words-generation";
import { GENERIC_PROMPTS } from "./generic-prompts";
import {
	logoNamedByLabel,
	logosNamedInText,
	matchIconMentions,
	matchIconsInText,
} from "./text-match";

function slugs(text: string, limit?: number) {
	return matchIconsInText(text, nodeLogoIcons, limit).map((icon) => icon.slug);
}

describe("matchIconsInText", () => {
	it("finds the technologies a prompt names, in order of mention", () => {
		expect(
			slugs(
				"Diagram our deploy pipeline: push to GitHub, build with Docker, run tests, ship to Cloudflare Workers.",
			),
		).toEqual(["github", "docker", "cloudflare"]);
		expect(
			slugs("User signs up with Clerk, data stored in Postgres via Prisma, emails via Resend."),
		).toEqual(["clerk", "postgresql", "prisma", "resend"]);
		expect(
			slugs("Next.js app on Vercel calls an OpenAI model, caches in Redis, and logs to Sentry"),
		).toEqual(["nextjs", "vercel", "openai", "redis", "sentry"]);
		expect(
			slugs("push code to github, build the docker image, run vitest, deploy to cloudflare"),
		).toEqual(["github", "docker", "vitest", "cloudflare"]);
	});

	it("matches aliases, multi-word names, and trailing punctuation", () => {
		expect(slugs("Run it on k8s.")).toEqual(["kubernetes"]);
		expect(slugs("Train on Google Cloud, then serve.")).toEqual(["googlecloud"]);
		expect(slugs("Deploy to (Docker)!")).toEqual(["docker"]);
		expect(slugs("store users in postgres via prisma")).toEqual(["postgresql", "prisma"]);
	});

	it("offers no logos for prompts that name no technology", () => {
		for (const prompt of GENERIC_PROMPTS) {
			expect(slugs(prompt), prompt).toEqual([]);
		}
		expect(slugs("constructor toString __proto__ hasOwnProperty")).toEqual([]);
	});

	it("counts everyday words only when cased as a name mid-sentence", () => {
		expect(slugs("A Go service on Render writes tickets to Linear")).toEqual([
			"go",
			"render",
			"linear",
		]);
		expect(slugs("Our React frontend talks to Supabase and sends Slack alerts.")).toEqual([
			"react",
			"supabase",
			"slack",
		]);
		expect(slugs("Load events into BigQuery with Dataflow")).toEqual(["bigquery", "dataflow"]);
		// Sentence starts, line starts, clauses after a colon, Title Case lines,
		// and all-caps abbreviations carry no signal.
		expect(slugs("Render it. Swift: delivery. Linear\nGo")).toEqual([]);
		expect(slugs("Ship it to Railway; Sentry catches errors.")).toEqual(["railway", "sentry"]);
		expect(slugs("Deploy With Go\nGo Live")).toEqual([]);
		expect(slugs("look up the user ID and the SYNC status")).toEqual([]);
	});

	it("marks which mentions could only be the product", () => {
		expect(
			matchIconMentions("We use Go, TypeScript, and Docker on k8s with Linear", nodeLogoIcons).map(
				({ icon, distinctive }) => [icon.slug, distinctive],
			),
		).toEqual([
			["go", false],
			["typescript", true],
			["docker", true],
			["kubernetes", true],
			["linear", false],
		]);
	});

	it("deduplicates repeated mentions and respects the limit", () => {
		expect(slugs("GitHub to GitHub to Docker to GitHub")).toEqual(["github", "docker"]);
		expect(slugs("GitHub Docker Cloudflare Redis", 2)).toEqual(["github", "docker"]);
	});

	it("offers marks that were once too large to embed, such as TanStack and Linux", () => {
		expect(slugs("TanStack Query and Zustand on Linux")).toEqual(["tanstack", "zustand", "linux"]);
	});
});

describe("logoNamedByLabel", () => {
	const named = (label: string) => logoNamedByLabel(label, nodeLogoIcons)?.slug;

	it("names the one logo a label unmistakably names", () => {
		expect(named("Ship to Cloudflare Workers")).toBe("cloudflare");
		expect(named("Cloudflare Worker")).toBe("cloudflare");
		expect(named("Store the answer in Redis")).toBe("redis");
		expect(named("Next.js page")).toBe("nextjs");
		expect(named("AWS ECS web service")).toBe("aws");
	});

	it("names nothing for labels that name no product", () => {
		for (const label of ["Test suite runs", "Tests pass?", "Notify the team and stop", "Stop"]) {
			expect(named(label), label).toBeUndefined();
		}
	});

	it("names nothing for everyday words that are also products", () => {
		for (const label of [
			"Go to checkout",
			"Write the service in Rust",
			"Rust service",
			"Send Mail",
			"Stream events",
			"Notion of done",
			"Ticket moves to Linear",
			"Log errors to Sentry",
		]) {
			expect(named(label), label).toBeUndefined();
		}
	});

	it("names nothing when a label names several products", () => {
		expect(named("Next.js page (Vercel) receives the question")).toBeUndefined();
		expect(named("Docker image pushed to GitHub")).toBeUndefined();
		// An everyday-word product beside a distinctive one is still ambiguous.
		expect(named("Docker build tickets in Linear")).toBeUndefined();
	});
});

describe("logosNamedInText", () => {
	it("offers each named logo with its aliases and catalog collection", () => {
		expect(
			logosNamedInText("Ship to Cloudflare Workers behind a Kubernetes ingress.", nodeLogoIcons),
		).toEqual([
			{
				aliases: ["Cloudflare"],
				collection: "cloud-vendors",
				name: "Cloudflare",
				slug: "cloudflare",
			},
			{
				aliases: ["Kubernetes", "k8s", "kube"],
				collection: "devtools-ci",
				name: "Kubernetes",
				slug: "kubernetes",
			},
		]);
	});
});

describe("common catalog words", () => {
	it("match the SCOWL list for the current catalog", () => {
		const generated: unknown = JSON.parse(
			readFileSync(new URL("./generated/common-words.json", import.meta.url), "utf8"),
		);
		// Regenerate with `nx run icon-catalog:generate-catalog`.
		expect(generated).toEqual(catalogCommonWords(iconManifest.icons, loadCommonEnglishWords()));
	});
});
