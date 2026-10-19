import { describe, expect, it } from "vitest";

import { nodeLogoIcons } from "./catalog.js";
import { iconMatch, isStrayVendorLogo, isVendorLogo, searchIcons } from "./search.js";

function iconOf(slug: string) {
	const icon = nodeLogoIcons.find((candidate) => candidate.slug === slug);
	if (!icon) throw new Error(`No catalog icon ${slug}.`);
	return icon;
}

function matchOf(query: string, slug: string) {
	return iconMatch(iconOf(slug), query);
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

describe("vendor logos on labels", () => {
	const named = (label: string, slug: string) => !isStrayVendorLogo(iconOf(slug), label);
	const vendor = (slug: string) => isVendorLogo(iconOf(slug));

	it("counts cloud vendors and the platforms the alias table names as vendor logos", () => {
		expect(["aws", "cloudflare", "googlecloud", "kubernetes", "gke"].map(vendor)).toEqual([
			true,
			true,
			true,
			true,
			true,
		]);
		expect(["docker", "postgresql", "github", "rabbitmq"].map(vendor)).toEqual([
			false,
			false,
			false,
			false,
		]);
	});

	it("keeps a vendor logo on a label that names the vendor", () => {
		expect(named("Cloudflare Workers", "cloudflare")).toBe(true);
		expect(named("Ship to Cloudflare Workers", "cloudflare")).toBe(true);
		expect(named("AWS Lambda", "aws")).toBe(true);
		expect(named("Amazon S3 bucket", "aws")).toBe(true);
		expect(named("GKE cluster", "gke")).toBe(true);
		expect(named("GKE cluster", "kubernetes")).toBe(true);
		expect(named("k8s ingress", "kubernetes")).toBe(true);
		expect(named("GCP project", "googlecloud")).toBe(true);
	});

	it("drops a vendor logo from a label that does not name the vendor", () => {
		expect(named("Ingress controller", "kubernetes")).toBe(false);
		expect(named("Web pods", "gke")).toBe(false);
		expect(named("S3 bucket", "aws")).toBe(false);
		expect(named("Deploy", "cloudflare")).toBe(false);
		expect(named("constructor toString", "aws")).toBe(false);
	});

	it("never questions a product's own logo", () => {
		expect(named("Primary database", "postgresql")).toBe(true);
		expect(named("Build the image", "docker")).toBe(true);
	});
});
