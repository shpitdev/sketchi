import { DiagramsHttpApi } from "@sketchi/diagrams/http-api";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { oneShotJsonClient } from "./one-shot-json-client";

/**
 * The generated diagrams client, sending each call to the one endpoint URL the command was given
 * (production by default, or a preview through `--endpoint` or the environment).
 */
export const diagramsClient = (endpoint: string) =>
	Effect.flatMap(HttpClient.HttpClient, (http) =>
		HttpApiClient.makeWith(DiagramsHttpApi, { httpClient: oneShotJsonClient(http, endpoint) }),
	);

export const decodeCreateCanvas = HttpApiClient.decodeResponse(DiagramsHttpApi, {
	group: "canvas",
	endpoint: "createCanvas",
});

export const decodeGenerate = HttpApiClient.decodeResponse(DiagramsHttpApi, {
	group: "generate",
	endpoint: "generate",
});
