import { DiagramsHttpApi } from "@sketchi/diagrams/http-api";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

/**
 * The generated diagrams client, sending each call to the one endpoint URL the command was given
 * (production by default, or a preview through `--endpoint` or the environment).
 */
export const diagramsClient = (endpoint: string) =>
	HttpApiClient.make(DiagramsHttpApi, {
		transformClient: HttpClient.mapRequest((request) =>
			request.pipe(
				HttpClientRequest.setUrl(endpoint),
				HttpClientRequest.setHeader("x-sketchi-client", "sketchi-cli"),
			),
		),
	});

export const decodeCreateCanvas = HttpApiClient.decodeResponse(DiagramsHttpApi, {
	group: "canvas",
	endpoint: "createCanvas",
});

export const decodeGenerate = HttpApiClient.decodeResponse(DiagramsHttpApi, {
	group: "generate",
	endpoint: "generate",
});
