export function localInspectorPort(appPort: number): number {
	return appPort + 10_000;
}

export function localViteCacheDir(appName: string): string {
	return new URL(`../../node_modules/.vite/apps/${appName}`, import.meta.url).pathname;
}
