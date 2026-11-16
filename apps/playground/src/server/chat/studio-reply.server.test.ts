import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream } from "effect";
import { Chat, LanguageModel, Response } from "effect/ai";
import { studioReplyStream, STUDIO_RAN_OUT_REPLY } from "./studio-reply.server";
import type { StudioTurnOutcome } from "./studio-build-tool.server";

const usage = new Response.Usage({inputTokens:{total:1},outputTokens:{total:1}});
const finish = (reason:Response.FinishReason = "stop") => Response.makePart("finish",{reason,usage});
const text = (value:string) => [Response.makePart("text-start",{id:"text"}),Response.makePart("text-delta",{id:"text",delta:value}),Response.makePart("text-end",{id:"text"})];
const noBuild:StudioTurnOutcome = {attempts:0,saved:false,rejected:[]};
const rejected:StudioTurnOutcome = {attempts:1,saved:false,rejected:[{code:"missing_field",message:"The review step needs a label."}]};
const words = (parts:ReadonlyArray<Response.AnyPart>) => parts.flatMap((part) => part.type === "text-delta" ? [part.delta] : []).join("");
const collect = (rounds:ReadonlyArray<ReadonlyArray<Response.AnyPart>>,outcome = noBuild) => Effect.gen(function* () {
 let runs=0;
 const parts = yield* studioReplyStream({run:() => Stream.fromIterable(rounds[runs++] ?? []),outcome:Effect.succeed(outcome)}).pipe(Stream.runCollect);
 return {parts,runs};
});

describe("Studio reply policy",() => {
 it.effect("holds text until a step completes and replaces a false success after rejected builds",() => Effect.gen(function* () {
   const started = yield* Deferred.make<void>();
   const release = yield* Deferred.make<void>();
   const seen:Response.AnyPart[]=[];
   const source = Stream.fromIterable(text("Saved your diagram.")).pipe(Stream.concat(Stream.fromEffect(Deferred.succeed(started,undefined)).pipe(Stream.drain)),Stream.concat(Stream.fromEffect(Deferred.await(release).pipe(Effect.as(finish())))));
   const fiber = yield* studioReplyStream({run:() => source,outcome:Effect.succeed(rejected)}).pipe(Stream.runForEach((part) => Effect.sync(() => {seen.push(part);})),Effect.forkScoped);
   yield* Deferred.await(started);
   expect(words(seen)).toBe("");
   yield* Deferred.succeed(release,undefined); yield* Fiber.join(fiber);
   expect(words(seen)).toContain("couldn't save"); expect(words(seen)).toContain("needs a label"); expect(words(seen)).not.toContain("Saved your diagram.");
 }));
 it.effect("preserves the answer when saved or when no build was needed",() => Effect.gen(function* () {
   for (const outcome of [noBuild,{...noBuild,attempts:1,saved:true}]) expect(words((yield* collect([[...text("Which title?"),finish()]],outcome)).parts)).toBe("Which title?");
 }));
 it.effect("explains a rejected build even when the last step says nothing",() => Effect.gen(function* () {
   expect(words((yield* collect([[finish()]],rejected)).parts)).toContain("couldn't save");
 }));
 it.effect("retries only empty output-limit finishes and stops after one retry",() => Effect.gen(function* () {
   const retried = yield* collect([[finish("length")],[...text("Done."),finish()]]);
   expect(retried.runs).toBe(2);expect(words(retried.parts)).toBe("Done.");
   const exhausted = yield* collect([[finish("length")],[finish("length")]]);
   expect(exhausted.runs).toBe(2);expect(words(exhausted.parts)).toBe(STUDIO_RAN_OUT_REPLY);
   expect((yield* collect([[...text("Partial"),finish("length")]])).runs).toBe(1);
 }));
 it.effect("cancellation interrupts the source and never retries",() => Effect.gen(function* () {
   const started=yield* Deferred.make<void>(); const stopped=yield* Deferred.make<void>();let runs=0;
   const fiber=yield* studioReplyStream({run:() => {runs++;return Stream.fromEffect(Deferred.succeed(started,undefined)).pipe(Stream.drain,Stream.concat(Stream.never),Stream.ensuring(Deferred.succeed(stopped,undefined)));},outcome:Effect.succeed(noBuild)}).pipe(Stream.runDrain,Effect.forkScoped);
   yield* Deferred.await(started);yield* Fiber.interrupt(fiber);yield* Deferred.await(stopped);expect(runs).toBe(1);
 }));
 it.effect("keeps native Chat history when retrying after an earlier round",() => Effect.gen(function* () {
   const prompts:unknown[]=[];
   const model=yield* LanguageModel.make({generateText:() => Effect.succeed([]),streamText:(options) => {prompts.push(options.prompt);return Stream.fromIterable(prompts.length===1 ? [finish("length")] : [...text("Done."),finish()]);}});
   const chat=yield* Chat.fromPrompt("Draw a review.");
   yield* studioReplyStream({run:() => chat.streamText({prompt:[]}),outcome:Effect.succeed(noBuild)}).pipe(Stream.runDrain,Effect.provideService(LanguageModel.LanguageModel,model));
   expect(prompts).toHaveLength(2);expect(JSON.stringify(prompts[1])).toContain("Draw a review.");
 }));
});
