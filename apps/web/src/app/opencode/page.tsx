"use client";

import { Check, Copy } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const npmUrl = "https://www.npmjs.com/package/@sketchi-app/opencode-excalidraw";
const githubUrl =
  "https://github.com/anand-testcompare/sketchi/tree/main/packages/opencode-excalidraw";
const webCommand = "opencode web";
const cliCommand = "opencode";

interface ModePreview {
  alt: string;
  dark: string;
  light: string;
}

type DemoPhase =
  | "typing-config"
  | "typing-web-command"
  | "ready-web"
  | "sending-web"
  | "loading-web"
  | "result-web"
  | "editing-cli-command"
  | "ready-cli"
  | "sending-cli"
  | "loading-cli"
  | "result-cli";

const webPreview: ModePreview = {
  alt: "Generated Excalidraw Diagram (OpenCode Web)",
  dark: "/screenshots/opencode-preview-dark.png",
  light: "/screenshots/opencode-preview-light.png",
};

const cliPreview: ModePreview = {
  alt: "Generated Excalidraw Diagram (OpenCode CLI)",
  dark: "/screenshots/opencode-terminal-dark.png",
  light: "/screenshots/opencode-terminal-light.png",
};

function useOpencodeDemo(
  pluginLine: string,
  previewFrameRef: { current: HTMLDivElement | null }
) {
  const [demoPhase, setDemoPhase] = useState<DemoPhase>("typing-config");
  const [typedPlugin, setTypedPlugin] = useState("");
  const [typedInstall, setTypedInstall] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stopSignal = Symbol("demo-stop");

    const wait = (ms: number) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(!cancelled), ms);
        timers.push(timer);
      });

    const ensure = async (task: Promise<boolean>) => {
      const ok = await task;
      if (!ok) {
        throw stopSignal;
      }
    };

    const typeText = async (
      text: string,
      setValue: (value: string) => void,
      delayMs: number,
      initialDelayMs = 0
    ): Promise<boolean> => {
      if (initialDelayMs > 0) {
        const waited = await wait(initialDelayMs);
        if (!waited) {
          return false;
        }
      }

      for (let i = 1; i <= text.length; i += 1) {
        if (cancelled) {
          return false;
        }
        setValue(text.slice(0, i));
        const waited = await wait(delayMs);
        if (!waited) {
          return false;
        }
      }

      return true;
    };

    const eraseTo = async (
      fromText: string,
      targetText: string,
      setValue: (value: string) => void,
      delayMs: number
    ): Promise<boolean> => {
      for (let i = fromText.length - 1; i >= targetText.length; i -= 1) {
        if (cancelled) {
          return false;
        }
        setValue(fromText.slice(0, i));
        const waited = await wait(delayMs);
        if (!waited) {
          return false;
        }
      }

      return true;
    };

    const waitUntilReplayAllowed = async () => {
      while (previewFrameRef.current?.matches(":hover")) {
        await ensure(wait(250));
      }
    };

    const runWebSequence = async () => {
      setDemoPhase("typing-web-command");
      await ensure(typeText(webCommand, setTypedInstall, 70, 650));
      setDemoPhase("ready-web");
      await ensure(wait(800));
      setDemoPhase("sending-web");
      await ensure(wait(1100));
      setDemoPhase("loading-web");
      await ensure(wait(1900));
      setDemoPhase("result-web");
      await ensure(wait(5500));
    };

    const runCliSequence = async () => {
      setDemoPhase("editing-cli-command");
      await ensure(wait(900));
      await ensure(eraseTo(webCommand, cliCommand, setTypedInstall, 110));
      setDemoPhase("ready-cli");
      await ensure(wait(900));
      setDemoPhase("sending-cli");
      await ensure(wait(1200));
      setDemoPhase("loading-cli");
      await ensure(wait(2100));
      setDemoPhase("result-cli");
      await ensure(wait(6500));
    };

    const runLoop = async () => {
      while (!cancelled) {
        setTypedPlugin("");
        setTypedInstall("");
        setDemoPhase("typing-config");

        await ensure(typeText(pluginLine, setTypedPlugin, 24));
        await ensure(wait(700));
        await runWebSequence();
        await runCliSequence();
        await waitUntilReplayAllowed();
      }
    };

    runLoop().catch((error) => {
      if (error !== stopSignal) {
        console.error("OpenCode demo animation failed", error);
      }
    });

    return () => {
      cancelled = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [pluginLine, previewFrameRef]);

  return { demoPhase, typedInstall, typedPlugin };
}

interface DemoUiState {
  preview: ModePreview | null;
  previewMode: "cli" | "web" | null;
  showCommandCursor: boolean;
  showLoading: boolean;
  showSending: boolean;
  showWaiting: boolean;
  waitingMessage: string;
}

function deriveDemoUiState(demoPhase: DemoPhase): DemoUiState {
  const showCommandCursor =
    demoPhase === "typing-web-command" || demoPhase === "editing-cli-command";
  const showLoading =
    demoPhase === "loading-web" || demoPhase === "loading-cli";
  const showSending =
    demoPhase === "sending-web" || demoPhase === "sending-cli";

  let waitingMessage = "Preparing terminal output...";
  if (demoPhase === "ready-web" || demoPhase === "ready-cli") {
    waitingMessage = "Command ready. Sending next...";
  } else if (showSending) {
    waitingMessage = "Sending command...";
  }

  let preview: ModePreview | null = null;
  let previewMode: "cli" | "web" | null = null;
  if (demoPhase === "result-web") {
    preview = webPreview;
    previewMode = "web";
  } else if (demoPhase === "result-cli") {
    preview = cliPreview;
    previewMode = "cli";
  }

  const showWaiting = !(showLoading || preview !== null);

  return {
    preview,
    previewMode,
    showCommandCursor,
    showLoading,
    showSending,
    showWaiting,
    waitingMessage,
  };
}

export default function OpenCodeDocsPage() {
  const [version, setVersion] = useState("latest");
  const [copied, setCopied] = useState(false);
  const previewFrameRef = useRef<HTMLDivElement>(null);

  // Default to "latest" since that dynamically ensures they have the newest plugin version,
  // preventing them from being stuck on an outdated hardcoded tag.
  const pluginLine = `    "@sketchi-app/opencode-excalidraw@${version}"`;

  const fullJsonConfig = `{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "@sketchi-app/opencode-excalidraw@${version}"
  ]
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullJsonConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    fetch("https://registry.npmjs.org/@sketchi-app/opencode-excalidraw/latest")
      .then((res) => res.json())
      .then((data) => {
        if (data.version) {
          setVersion(data.version);
        }
      })
      .catch((e) => console.error("Failed to fetch version", e));
  }, []);

  const { demoPhase, typedInstall, typedPlugin } = useOpencodeDemo(
    pluginLine,
    previewFrameRef
  );
  const demoUi = deriveDemoUiState(demoPhase);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <section className="relative overflow-hidden rounded-[2rem] border-2 bg-card p-6 sm:p-10">
        <div className="relative z-10 mb-8 flex flex-col items-start justify-between gap-6 sm:flex-row">
          <div className="space-y-3">
            <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
              OpenCode plugin docs
            </h1>
            <ol className="ml-5 list-decimal space-y-1 text-base text-muted-foreground leading-relaxed">
              <li>
                Update{" "}
                <code className="rounded border bg-muted/50 px-1.5 py-0.5">
                  opencode.jsonc
                </code>
                .
              </li>
              <li>
                Run <code>opencode web</code>.
              </li>
              <li>
                Then switch to <code>opencode</code> and run again in terminal
                mode.
              </li>
            </ol>
          </div>
          <span className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-primary/20 bg-primary/10 px-4 py-1.5 font-medium text-primary text-sm transition-colors hover:bg-primary/20">
            v{version}
          </span>
        </div>

        <div className="relative z-10 mb-8 flex flex-wrap items-center gap-4">
          <a
            aria-label="Open npm package"
            className="group flex items-center gap-2 rounded-xl border-2 border-transparent bg-muted/30 px-5 py-2.5 transition-all hover:-translate-y-0.5 hover:-rotate-2 hover:border-foreground/15 hover:bg-muted/50"
            href={npmUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="relative h-8 w-16">
              <Image
                alt="NPM"
                className="object-contain opacity-80 transition-opacity group-hover:opacity-100"
                fill
                src="/icons/npm-text-svg.svg"
              />
            </div>
          </a>
          <a
            aria-label="Open GitHub repository"
            className="group flex items-center gap-2 rounded-xl border-2 border-transparent bg-muted/30 px-5 py-2.5 transition-all hover:-translate-y-0.5 hover:rotate-2 hover:border-foreground/15 hover:bg-muted/50"
            href={githubUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="relative h-8 w-8">
              <Image
                alt="GitHub"
                className="object-contain opacity-80 transition-opacity group-hover:opacity-100 dark:hidden"
                fill
                src="/icons/github-svg.svg"
              />
              <Image
                alt="GitHub Dark"
                className="hidden object-contain opacity-80 transition-opacity group-hover:opacity-100 dark:block"
                fill
                src="/icons/github-dark-svg.svg"
              />
            </div>
            <span className="font-(family-name:--font-caveat) text-foreground/80 text-xl group-hover:text-foreground">
              GitHub
            </span>
          </a>
        </div>

        <div className="relative z-10 grid gap-6 md:grid-cols-[1fr_1.2fr] lg:gap-10">
          <div className="flex flex-col gap-4">
            <section
              aria-label="Animated code block"
              className="overflow-hidden rounded-2xl border-2 border-zinc-200/50 bg-[#1e1e1e] shadow-sm transition-colors dark:border-white/10 dark:bg-[#0d0d0d]"
            >
              <div className="flex items-center justify-between border-white/10 border-b bg-white/5 px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded-full bg-[#ff5f56]" />
                  <div className="size-3 rounded-full bg-[#ffbd2e]" />
                  <div className="size-3 rounded-full bg-[#27c93f]" />
                  <span className="ml-2 font-medium text-white/50 text-xs">
                    opencode.jsonc
                  </span>
                </div>
                <button
                  aria-label="Copy config"
                  className="flex items-center gap-1.5 rounded bg-white/10 px-2 py-1 text-white/70 text-xs transition-colors hover:bg-white/20 hover:text-white"
                  onClick={handleCopy}
                  type="button"
                >
                  {copied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="p-5">
                <code className="block whitespace-pre font-mono text-sm text-zinc-300 leading-7">
                  <span className="text-[#569cd6]">{"{\n"}</span>
                  <span className="text-[#9cdcfe]">{'  "$schema"'}</span>
                  <span className="text-zinc-300">{": "}</span>
                  <span className="text-[#ce9178]">
                    {'"https://opencode.ai/config.json"'}
                  </span>
                  <span className="text-zinc-300">{",\n"}</span>
                  <span className="text-[#9cdcfe]">{'  "plugins"'}</span>
                  <span className="text-zinc-300">{": [\n"}</span>
                  <span className="text-[#ce9178]">{typedPlugin}</span>
                  {typedPlugin.length < pluginLine.length && (
                    <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-300 align-[-0.12em]" />
                  )}
                  <span className="text-zinc-300">{"\n  ]\n"}</span>
                  <span className="text-[#569cd6]">{"}"}</span>
                </code>
              </div>
            </section>

            <div className="overflow-hidden rounded-2xl border-2 border-zinc-200/50 bg-[#1e1e1e] shadow-sm dark:border-white/10 dark:bg-[#0d0d0d]">
              <div className="flex items-center border-white/10 border-b bg-white/5 px-4 py-2.5">
                <span className="font-medium text-white/50 text-xs">
                  terminal
                </span>
              </div>
              <div className="p-5">
                <code className="flex min-h-7 items-center font-mono text-sm text-zinc-300">
                  <span className="mr-3 text-[#27c93f]">$</span>
                  <span>{typedInstall}</span>
                  {demoUi.showCommandCursor && (
                    <span className="ml-1.5 inline-block h-4 w-2 animate-pulse bg-zinc-300" />
                  )}
                  {demoUi.showSending && (
                    <span className="ml-2 text-emerald-400 text-xs">
                      [enter]
                    </span>
                  )}
                </code>
              </div>
            </div>
          </div>

          <div
            className="relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/20"
            ref={previewFrameRef}
          >
            {demoUi.showWaiting && (
              <div className="flex animate-pulse flex-col items-center gap-3 opacity-50">
                <div className="rounded border border-muted-foreground/30 px-3 py-2 font-mono text-muted-foreground text-xs">
                  {demoUi.waitingMessage}
                </div>
                <span className="font-medium text-muted-foreground text-sm">
                  Waiting for command send
                </span>
              </div>
            )}

            {demoUi.showLoading && (
              <div className="flex flex-col items-center gap-3 opacity-75">
                <div className="size-10 animate-spin rounded-full border-4 border-muted-foreground/20 border-t-muted-foreground/60" />
                <span className="font-medium text-muted-foreground text-sm">
                  Launching preview...
                </span>
              </div>
            )}

            {demoUi.preview && (
              <div className="absolute inset-0 flex items-center justify-center p-4 transition-all duration-700 ease-out">
                <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-background">
                  <Image
                    alt={demoUi.preview.alt}
                    className={`dark:hidden ${
                      demoUi.previewMode === "web"
                        ? "object-cover object-top-left"
                        : "object-cover object-center"
                    }`}
                    fill
                    src={demoUi.preview.light}
                  />
                  <Image
                    alt={demoUi.preview.alt}
                    className={`hidden dark:block ${
                      demoUi.previewMode === "web"
                        ? "object-cover object-top-left"
                        : "object-cover object-center"
                    }`}
                    fill
                    src={demoUi.preview.dark}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
