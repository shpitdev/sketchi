import { type CommunityIconResult } from "@sketchi/community-icons/http-api";
import { String } from "effect";

/** The gallery uses the shared wire contract without adding query ownership. */
export type CommunityIconEntry = Pick<
	CommunityIconResult,
	"slug" | "name" | "recipe" | "createdAt" | "url"
>;
export function bareSlug(slug: string): string {
	return String.replace(/^community\//u, "")(slug);
}
