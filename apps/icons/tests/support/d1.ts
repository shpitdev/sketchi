import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { D1Client } from "@effect/sql-d1";
/** Actual isolated workerd D1; no SQL matching or prepared-statement emulation. */
export async function openD1(): Promise<{
	database: D1Client.D1ClientConfig["db"];
	dispose: () => Promise<void>;
}> {
	const base = resolve(".memory/icons-server");
	await mkdir(base, { recursive: true });
	const directory = await mkdtemp(`${base}/d1-`);
	const configPath = `${directory}/wrangler.json`;
	await writeFile(
		configPath,
		JSON.stringify({
			name: "icons-unit-local",
			compatibility_date: "2026-11-01",
			d1_databases: [
				{
					binding: "DB",
					database_name: "icons-unit-local",
					database_id: "00000000-0000-0000-0000-000000000001",
				},
			],
		}),
	);
	const proxy = await getPlatformProxy<{ DB: D1Client.D1ClientConfig["db"] }>({
		configPath,
		persist: false,
		remoteBindings: false,
		envFiles: [],
	});
	return {
		database: proxy.env.DB,
		dispose: async () => {
			await proxy.dispose();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
