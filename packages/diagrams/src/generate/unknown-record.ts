export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function objectValue(value: unknown, key: string): unknown {
	return isUnknownRecord(value) ? value[key] : undefined;
}
