// @vitest-environment node

import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { getPlatformProxy } from "wrangler";

import { COMMUNITY_ICON_LIMITS, type CommunityEnv } from "@sketchi/community-icons";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import { studioCommunityIcons } from "../community-icons.server";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function nativeDatabase() {
	const base = resolve(".memory/icons-server");
	await mkdir(base, { recursive: true });
	const directory = await mkdtemp(`${base}/studio-d1-`);
	const configPath = `${directory}/wrangler.json`;
	await writeFile(
		configPath,
		JSON.stringify({
			name: "studio-community-local",
			compatibility_date: "2026-11-01",
			d1_databases: [
				{
					binding: "DB",
					database_name: "studio-community-local",
					database_id: "00000000-0000-0000-0000-000000000001",
				},
			],
		}),
	);
	const proxy = await getPlatformProxy<{ DB: NonNullable<CommunityEnv["COMMUNITY_ICONS"]> }>({
		configPath,
		persist: false,
		remoteBindings: false,
		envFiles: [],
	});
	cleanups.push(async () => {
		await proxy.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	return proxy.env.DB;
}
const RING = { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 }] };

describe("Studio community icons", () => {
	it("finds the icon a query names exactly behind a full page of newer partial matches", async () => {
		const database = await nativeDatabase();
		const source = studioCommunityIcons(database);
		expect(await Effect.runPromise(source.search("Acme"))).toEqual([]);
		const insert = (slug: string, name: string, createdAt: string) =>
			database
				.prepare(
					"INSERT INTO community_icons (slug, name, recipe, colors, hash, verdict, created_at, hidden) VALUES (?, ?, ?, '[]', ?, NULL, ?, 0)",
				)
				.bind(slug, name, JSON.stringify(RING), slug, createdAt)
				.run();
		await insert("acme", "Acme", "2026-11-01T00:00:00.000Z");
		for (let index = 0; index < COMMUNITY_ICON_LIMITS.maxPageSize; index += 1) {
			await insert(`acme-old-${index}`, `Acme old ${index}`, "2026-11-08T00:00:00.000Z");
		}
		const found = await Effect.runPromise(source.search("Acme"));
		expect(found[0]).toEqual({ slug: "community/acme", name: "Acme", recipe: RING });
		expect(found).toHaveLength(COMMUNITY_ICON_LIMITS.maxPageSize + 1);
	});
});
