import { describe, expect, it } from "vitest";

import { getIconBySlug } from "./catalog";
import { VENDOR_ALIAS_SLUGS, vendorAliases } from "./vendor-aliases";

describe("vendor aliases", () => {
	it("names only catalog marks", () => {
		for (const slug of VENDOR_ALIAS_SLUGS) {
			expect(getIconBySlug(slug)?.slug, slug).toBe(slug);
		}
	});

	it("writes a well-known AWS service with either prefix and bare", () => {
		expect(vendorAliases({ collection: "aws", name: "Amazon S3", slug: "amazon-s3" })).toEqual([
			"AWS S3",
			"S3",
		]);
		expect(vendorAliases({ collection: "aws", name: "AWS Glue", slug: "aws-glue" })).toEqual([
			"Amazon Glue",
			"Glue",
		]);
	});

	it("adds nothing to services without a bare name, categories or other collections", () => {
		expect(vendorAliases({ collection: "aws", name: "AWS Batch", slug: "aws-batch" })).toEqual([]);
		expect(
			vendorAliases({
				collection: "aws",
				name: "AWS Storage Category",
				slug: "aws-storage-category",
			}),
		).toEqual([]);
		expect(vendorAliases({ collection: "gcp", name: "Cloud Run", slug: "cloud-run" })).toEqual([]);
	});
});
