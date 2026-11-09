import {
	handleCommunityDetail as detail,
	handleCommunityList as list,
	handleCommunityPublish as publish,
	handleCommunityVisibility as visibility,
	type CommunityEnv,
} from "@sketchi/community-icons";

import { withCors } from "./cors-policy.js";

export type { CommunityEnv };

/** `POST /api/community`. */
export async function handleCommunityPublish(request: Request, env: CommunityEnv) {
	return withCors(await publish(request, env));
}

/** `GET /api/community`. */
export async function handleCommunityList(request: Request, env: CommunityEnv) {
	return withCors(await list(request, env));
}

/** `GET /api/community/:slug`. */
export async function handleCommunityDetail(request: Request, env: CommunityEnv, slug: string) {
	return withCors(await detail(request, env, slug));
}

/** `PATCH /api/community/:slug`, the owner's hide and restore. */
export async function handleCommunityVisibility(request: Request, env: CommunityEnv, slug: string) {
	return withCors(await visibility(request, env, slug));
}
