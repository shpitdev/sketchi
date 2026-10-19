import {
	type ErCardinality,
	type ErDiagram,
	parseErDiagram,
	parseErFieldShorthand,
} from "./types/er.js";

type Table = readonly [id: string, fields: readonly string[]];
type Link = readonly [
	from: string,
	to: string,
	fromCardinality: ErCardinality,
	toCardinality: ErCardinality,
	label?: string,
];

function schema(
	id: string,
	title: string,
	tables: readonly Table[],
	links: readonly Link[],
): ErDiagram {
	return parseErDiagram({
		id,
		title,
		type: "er",
		entities: tables.map(([entity, fields]) => ({
			id: entity,
			fields: fields.map(parseErFieldShorthand),
		})),
		relationships: links.map(([from, to, fromCardinality, toCardinality, label], index) => ({
			id: `r${index + 1}`,
			from,
			to,
			fromCardinality,
			toCardinality,
			...(label ? { label } : {}),
		})),
	});
}

/**
 * Schemas that stress the ER layout: twenty tables and over a hundred fields,
 * tables that reference themselves, and join tables fanning out from one hub.
 */
export const erStressFixtures = {
	marketplace: schema(
		"marketplace-schema",
		"Marketplace schema",
		[
			["users", ["id uuid PK", "email text UK", "name text", "created_at timestamptz"]],
			["profiles", ["user_id uuid PK FK", "bio text?", "avatar_url text?"]],
			[
				"addresses",
				["id uuid PK", "user_id uuid FK", "line1 text", "city text", "country char(2)"],
			],
			[
				"sellers",
				["id uuid PK", "user_id uuid FK UK", "payout_account text", "verified_at timestamptz?"],
			],
			["stores", ["id uuid PK", "seller_id uuid FK", "name text", "slug text UK"]],
			["categories", ["id uuid PK", "parent_id uuid FK?", "name text", "slug text UK"]],
			[
				"products",
				["id uuid PK", "store_id uuid FK", "title text", "price numeric(10,2)", "status text"],
			],
			["product_categories", ["product_id uuid PK FK", "category_id uuid PK FK"]],
			["product_images", ["id uuid PK", "product_id uuid FK", "url text", "position int"]],
			[
				"inventory",
				["product_id uuid PK FK", "on_hand int", "reserved int", "updated_at timestamptz"],
			],
			[
				"orders",
				[
					"id uuid PK",
					"user_id uuid FK",
					"address_id uuid FK",
					"status text",
					"placed_at timestamptz",
				],
			],
			[
				"order_items",
				[
					"order_id uuid PK FK",
					"product_id uuid PK FK",
					"quantity int",
					"unit_price numeric(10,2)",
				],
			],
			[
				"payments",
				[
					"id uuid PK",
					"order_id uuid FK",
					"amount numeric(10,2)",
					"provider text",
					"paid_at timestamptz?",
				],
			],
			["refunds", ["id uuid PK", "payment_id uuid FK", "amount numeric(10,2)", "reason text?"]],
			["carriers", ["id uuid PK", "name text UK", "tracking_url text"]],
			[
				"shipments",
				[
					"id uuid PK",
					"order_id uuid FK",
					"carrier_id uuid FK",
					"tracking_code text?",
					"shipped_at timestamptz?",
				],
			],
			[
				"reviews",
				["id uuid PK", "product_id uuid FK", "user_id uuid FK", "rating int", "body text?"],
			],
			["coupons", ["id uuid PK", "code text UK", "percent_off int", "expires_at timestamptz?"]],
			["order_coupons", ["order_id uuid PK FK", "coupon_id uuid PK FK"]],
			["wishlist_items", ["user_id uuid PK FK", "product_id uuid PK FK", "added_at timestamptz"]],
		],
		[
			["users.id", "profiles.user_id", "one", "zero-or-one"],
			["users.id", "addresses.user_id", "one", "zero-or-many"],
			["users.id", "sellers.user_id", "one", "zero-or-one"],
			["sellers.id", "stores.seller_id", "one", "one-or-many", "runs"],
			["categories.id", "categories.parent_id", "zero-or-one", "zero-or-many", "contains"],
			["stores.id", "products.store_id", "one", "zero-or-many", "lists"],
			["products.id", "product_categories.product_id", "one", "one-or-many"],
			["categories.id", "product_categories.category_id", "one", "zero-or-many"],
			["products.id", "product_images.product_id", "one", "zero-or-many"],
			["products.id", "inventory.product_id", "one", "zero-or-one"],
			["users.id", "orders.user_id", "one", "zero-or-many", "places"],
			["addresses.id", "orders.address_id", "one", "zero-or-many"],
			["orders.id", "order_items.order_id", "one", "one-or-many"],
			["products.id", "order_items.product_id", "one", "zero-or-many"],
			["orders.id", "payments.order_id", "one", "zero-or-many"],
			["payments.id", "refunds.payment_id", "one", "zero-or-many"],
			["orders.id", "shipments.order_id", "one", "zero-or-many"],
			["carriers.id", "shipments.carrier_id", "one", "zero-or-many"],
			["products.id", "reviews.product_id", "one", "zero-or-many"],
			["users.id", "reviews.user_id", "one", "zero-or-many", "writes"],
			["orders.id", "order_coupons.order_id", "one", "zero-or-many"],
			["coupons.id", "order_coupons.coupon_id", "one", "zero-or-many"],
			["users.id", "wishlist_items.user_id", "one", "zero-or-many"],
			["products.id", "wishlist_items.product_id", "one", "zero-or-many"],
		],
	),
	selfReferences: schema(
		"threaded-comments",
		"Threaded comments",
		[
			[
				"comments",
				["id int PK", "parent_id int FK?", "quoted_id int FK?", "author_id int FK", "body text"],
			],
			["authors", ["id int PK", "mentor_id int FK?", "handle text UK"]],
		],
		[
			["comments.id", "comments.parent_id", "zero-or-one", "zero-or-many", "replies"],
			["comments.id", "comments.quoted_id", "zero-or-one", "zero-or-many", "quotes"],
			["authors.id", "comments.author_id", "one", "zero-or-many"],
			["authors.id", "authors.mentor_id", "zero-or-one", "zero-or-many", "mentors"],
		],
	),
	manyToManyFans: schema(
		"tag-fans",
		"Tags everywhere",
		[
			["tags", ["id int PK", "name text UK"]],
			["posts", ["id int PK", "title text"]],
			["products", ["id int PK", "sku text UK"]],
			["users", ["id int PK", "email text UK"]],
			["events", ["id int PK", "starts_at timestamptz"]],
			["post_tags", ["post_id int PK FK", "tag_id int PK FK"]],
			["product_tags", ["product_id int PK FK", "tag_id int PK FK"]],
			["user_tags", ["user_id int PK FK", "tag_id int PK FK"]],
			["event_tags", ["event_id int PK FK", "tag_id int PK FK"]],
		],
		[
			["posts.id", "post_tags.post_id", "one", "zero-or-many"],
			["tags.id", "post_tags.tag_id", "one", "zero-or-many"],
			["products.id", "product_tags.product_id", "one", "zero-or-many"],
			["tags.id", "product_tags.tag_id", "one", "zero-or-many"],
			["users.id", "user_tags.user_id", "one", "zero-or-many"],
			["tags.id", "user_tags.tag_id", "one", "zero-or-many"],
			["events.id", "event_tags.event_id", "one", "zero-or-many"],
			["tags.id", "event_tags.tag_id", "one", "zero-or-many"],
		],
	),
} as const satisfies Record<string, ErDiagram>;
