import { describe, expect, it } from "vitest";

import { nodeLogoIcons } from "./catalog.js";
import { iconMatch, searchIcons } from "./search.js";

function matchOf(query: string, slug: string) {
	const icon = nodeLogoIcons.find((candidate) => candidate.slug === slug);
	if (!icon) throw new Error(`No catalog icon ${slug}.`);
	return iconMatch(icon, query);
}

describe("icon match quality", () => {
	it("calls a product's own icon exact, generic words aside", () => {
		expect(matchOf("PostgreSQL", "postgresql")).toBe("exact");
		expect(matchOf("postgres database", "postgresql")).toBe("exact");
		expect(matchOf("Cloud SQL", "cloud-sql")).toBe("exact");
		expect(matchOf("RabbitMQ", "rabbitmq")).toBe("exact");
		expect(matchOf("AWS", "aws")).toBe("exact");
		expect(matchOf("Google Kubernetes Engine", "google-kubernetes-engine")).toBe("exact");
	});

	it("calls a vendor's or umbrella's logo for one of its products vendor", () => {
		expect(matchOf("Amazon S3", "aws")).toBe("vendor");
		expect(matchOf("AWS ECS", "aws")).toBe("vendor");
		expect(matchOf("AWS Lambda", "aws")).toBe("vendor");
		expect(matchOf("Kubernetes pods", "kubernetes")).toBe("vendor");
		expect(matchOf("GKE ingress", "gke")).toBe("vendor");
	});

	it("calls anything fuzzier weak", () => {
		expect(matchOf("post", "postgresql")).toBe("weak");
		expect(matchOf("ingress", "google-kubernetes-engine")).toBe("weak");
	});

	it("tags what search returns for product queries the catalog lacks", () => {
		const tagged = (query: string) =>
			searchIcons(nodeLogoIcons, { query, limit: 3 }).map(({ icon }) => [
				icon.slug,
				iconMatch(icon, query),
			]);
		expect(tagged("amazon s3")[0]).toEqual(["aws", "vendor"]);
		expect(tagged("PostgreSQL")[0]).toEqual(["postgresql", "exact"]);
	});
});
