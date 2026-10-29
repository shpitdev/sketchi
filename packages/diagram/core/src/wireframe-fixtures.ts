import { parseWireframeDiagram, type WireframeDiagram } from "./types/wireframe.js";

const kpi = (title: string, value: string, change: string) => ({
	type: "card",
	title,
	children: [
		{ type: "heading", level: 2, text: value },
		{ type: "badge", text: change },
	],
});

/** Wireframes that exercise every component, device and layout rule; stories and fuzz seeds draw them. */
export const wireframeStressFixtures: Readonly<Record<string, WireframeDiagram>> = {
	dashboard: parseWireframeDiagram({
		id: "saas-dashboard",
		title: "SaaS dashboard",
		type: "wireframe",
		screens: [
			{
				id: "dashboard",
				name: "Dashboard",
				device: "desktop",
				children: [
					{
						type: "header",
						children: [
							{ type: "heading", level: 3, text: "Acme Analytics" },
							{ type: "search", placeholder: "Search orders" },
							{ type: "icon", label: "Alerts" },
							{ type: "avatar", label: "Dana Scully" },
						],
					},
					{
						type: "sidebar",
						children: [
							{
								type: "nav",
								items: ["Overview", "Orders", "Customers", "Products", "Settings"],
								active: "Overview",
							},
						],
					},
					{
						type: "main",
						children: [
							{
								type: "row",
								children: [
									{ type: "heading", level: 1, text: "Overview" },
									{ type: "button", text: "Export", variant: "secondary" },
									{ type: "button", text: "New order", variant: "primary" },
								],
							},
							{
								type: "grid",
								columns: 4,
								children: [
									kpi("Revenue", "$48,200", "+12%"),
									kpi("Orders", "1,284", "+4%"),
									kpi("Customers", "862", "+9%"),
									kpi("Refunds", "14", "-2%"),
								],
							},
							{
								type: "card",
								title: "Revenue over time",
								children: [{ type: "chart", kind: "line" }],
							},
							{
								type: "card",
								title: "Recent orders",
								children: [
									{
										type: "table",
										columns: ["Order", "Customer", "Date", "Total", "Status"],
										rows: 5,
									},
								],
							},
						],
					},
				],
			},
		],
	}),
	settings: parseWireframeDiagram({
		id: "settings-form",
		title: "Account settings",
		type: "wireframe",
		screens: [
			{
				id: "settings",
				name: "Settings",
				device: "desktop",
				children: [
					{
						type: "header",
						children: [
							{ type: "heading", level: 3, text: "Acme" },
							{ type: "nav", items: ["Home", "Projects", "Settings"], active: "Settings" },
							{ type: "avatar", label: "Ada Lovelace" },
						],
					},
					{
						type: "main",
						children: [
							{ type: "breadcrumbs", items: ["Home", "Settings", "Account"] },
							{ type: "heading", level: 1, text: "Account settings" },
							{ type: "tabs", items: ["Profile", "Notifications", "Billing"], active: "Profile" },
							{
								type: "section",
								title: "Profile",
								children: [
									{
										type: "grid",
										columns: 2,
										children: [
											{ type: "input", label: "Full name", placeholder: "Ada Lovelace" },
											{ type: "input", label: "Email", placeholder: "ada@example.com" },
										],
									},
									{ type: "select", label: "Time zone", value: "Europe/London" },
									{
										type: "textarea",
										label: "Bio",
										placeholder: "Tell people about yourself",
										rows: 3,
									},
								],
							},
							{ type: "divider" },
							{
								type: "section",
								title: "Notifications",
								children: [
									{ type: "toggle", label: "Email me about new comments", checked: true },
									{ type: "toggle", label: "Weekly summary" },
									{ type: "toggle", label: "Product announcements", disabled: true },
									{ type: "checkbox", label: "Also send to my phone" },
									{ type: "radio", label: "Instantly", checked: true },
									{ type: "radio", label: "Daily digest" },
								],
							},
						],
					},
					{
						type: "footer",
						align: "end",
						children: [
							{ type: "button", text: "Cancel", variant: "secondary" },
							{ type: "button", text: "Save changes", variant: "primary" },
						],
					},
				],
			},
		],
	}),
	product: parseWireframeDiagram({
		id: "product-page",
		title: "Product page",
		type: "wireframe",
		screens: [
			{
				id: "product",
				name: "Product",
				device: "desktop",
				children: [
					{
						type: "header",
						children: [
							{ type: "heading", level: 3, text: "Trailhead" },
							{ type: "nav", items: ["Men", "Women", "Sale"] },
							{ type: "search", placeholder: "Search" },
							{ type: "icon", label: "Cart" },
						],
					},
					{
						type: "main",
						children: [
							{ type: "breadcrumbs", items: ["Home", "Shoes", "Trail runners"] },
							{
								type: "row",
								children: [
									{
										type: "column",
										children: [
											{ type: "image", label: "Product photo", aspect: "square" },
											{
												type: "grid",
												columns: 4,
												children: Array.from({ length: 4 }, () => ({
													type: "image",
													aspect: "square",
												})),
											},
										],
									},
									{
										type: "column",
										children: [
											{ type: "badge", text: "New arrival" },
											{ type: "heading", level: 1, text: "Summit Trail Runner" },
											{ type: "text", text: "Rated 4.6 from 128 reviews" },
											{ type: "heading", level: 2, text: "$129.00" },
											{ type: "text", lines: 3 },
											{ type: "select", label: "Size", placeholder: "Choose a size" },
											{
												type: "row",
												children: [
													{ type: "button", text: "Add to cart", variant: "primary" },
													{ type: "button", text: "Save", variant: "secondary" },
												],
											},
											{ type: "list", items: ["Free shipping over $50", "30-day returns"] },
										],
									},
								],
							},
							{
								type: "tabs",
								items: ["Description", "Reviews", "Shipping"],
								active: "Description",
							},
							{ type: "text", lines: 4 },
						],
					},
					{
						type: "footer",
						children: [
							{ type: "text", text: "© 2026 Trailhead" },
							{ type: "nav", items: ["Help", "Returns", "Contact"] },
						],
					},
				],
			},
		],
	}),
	signupFlow: parseWireframeDiagram({
		id: "signup-flow",
		title: "Signup flow",
		type: "wireframe",
		screens: [
			{
				id: "signup",
				name: "Sign up",
				device: "mobile",
				children: [
					{ type: "heading", text: "Create your account" },
					{ type: "input", label: "Email", placeholder: "you@example.com" },
					{ type: "input", label: "Password", placeholder: "At least 8 characters" },
					{ type: "checkbox", label: "I agree to the terms" },
					{ type: "button", text: "Continue", variant: "primary" },
				],
			},
			{
				id: "verify",
				name: "Verify email",
				device: "mobile",
				align: "center",
				children: [
					{ type: "icon", label: "Mail" },
					{ type: "heading", text: "Check your inbox" },
					{ type: "text", text: "We sent a six-digit code to you@example.com." },
					{ type: "input", label: "Code", placeholder: "123456" },
					{ type: "button", text: "Verify", variant: "primary" },
					{ type: "link", text: "Resend code" },
				],
			},
			{
				id: "welcome",
				name: "Welcome",
				device: "mobile",
				children: [
					{ type: "image", label: "Celebration", aspect: "wide" },
					{ type: "heading", text: "You're all set" },
					{ type: "text", lines: 2 },
					{ type: "button", text: "Go to dashboard", variant: "primary" },
				],
			},
		],
	}),
	tabletModal: parseWireframeDiagram({
		id: "delete-project",
		title: "Delete project",
		type: "wireframe",
		screens: [
			{
				id: "projects",
				name: "Projects",
				device: "tablet",
				children: [
					{
						type: "header",
						children: [
							{ type: "heading", level: 3, text: "Projects" },
							{ type: "button", text: "New project", variant: "primary" },
						],
					},
					{
						type: "list",
						items: ["Website redesign", "Mobile app", "Data warehouse", "Brand refresh"],
					},
					{
						type: "modal",
						title: "Delete project?",
						children: [
							{ type: "text", text: "This removes Mobile app and its 14 files for everyone." },
							{ type: "input", label: "Type the project name", placeholder: "Mobile app" },
							{
								type: "row",
								align: "end",
								children: [
									{ type: "button", text: "Cancel", variant: "secondary" },
									{ type: "button", text: "Delete", variant: "primary" },
								],
							},
						],
					},
				],
			},
		],
	}),
	dense: parseWireframeDiagram({
		id: "dense-mobile",
		title: "Dense mobile screen",
		type: "wireframe",
		screens: [
			{
				id: "feed",
				name: "Feed",
				device: "mobile",
				children: [
					{
						type: "header",
						children: [
							{ type: "icon", label: "Menu" },
							{ type: "heading", level: 3, text: "Internationalization" },
							{ type: "avatar" },
						],
					},
					{ type: "search" },
					{
						type: "tabs",
						items: ["For you", "Following", "Trending now", "Local news", "Saved"],
						active: "Following",
					},
					{
						type: "grid",
						columns: 3,
						children: [
							kpi("Unread notifications", "12", "new"),
							kpi("Drafts", "3", "today"),
							kpi("Scheduled", "1", "soon"),
						],
					},
					{
						type: "card",
						title: "Top stories this week across every team",
						children: [
							{ type: "table", columns: ["Headline", "Author", "Reads", "Published"], rows: 3 },
						],
					},
					{ type: "chart", kind: "pie", label: "Readers by region" },
					{
						type: "row",
						children: [
							{ type: "badge", text: "Design" },
							{ type: "badge", text: "Engineering" },
							{ type: "badge", text: "Operations" },
							{ type: "badge", text: "Customer success" },
							{ type: "badge", text: "Marketing" },
						],
					},
				],
			},
		],
	}),
};
