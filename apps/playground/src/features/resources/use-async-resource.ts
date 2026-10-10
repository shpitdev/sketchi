import { QueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";

export type AsyncResource<T extends object> =
	| { status: "loading" }
	| { message: string; status: "error" }
	| (T & { status: "ready" });

/** Route-local query ownership: dependency changes and unmount abort the load. */
export function useAsyncResource<T extends object>(
	load: (signal: AbortSignal) => Promise<T>,
	deps: readonly unknown[],
	errorMessage: string,
): AsyncResource<T> {
	const [client] = useState(() => new QueryClient());
	const query = useQuery(
		{
			queryKey: deps,
			queryFn: ({ signal }) => load(signal),
			gcTime: 0,
			retry: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
		client,
	);
	if (query.isPending) return { status: "loading" };
	if (query.isError)
		return {
			status: "error",
			message: query.error instanceof Error ? query.error.message : errorMessage,
		};
	return { ...query.data, status: "ready" };
}
