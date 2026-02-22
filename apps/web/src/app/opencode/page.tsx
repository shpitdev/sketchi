"use client";

import { Check, Copy } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

const npmUrl = "https://www.npmjs.com/package/@sketchi-app/opencode-excalidraw";
const githubUrl =
  "https://github.com/anand-testcompare/sketchi/tree/main/packages/opencode-excalidraw";
const installCommand = "opencode";

export default function OpenCodeDocsPage() {
  const [typedPlugin, setTypedPlugin] = useState("");
  const [typedInstall, setTypedInstall] = useState("");
  const [version, setVersion] = useState("latest");
  const [isHovering, setIsHovering] = useState(false);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (isHovering) {
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;

    if (typedPlugin.length < pluginLine.length) {
      timeoutId = setTimeout(() => {
        setTypedPlugin(pluginLine.slice(0, typedPlugin.length + 1));
      }, 20);
      return () => clearTimeout(timeoutId);
    }

    if (typedInstall.length < installCommand.length) {
      timeoutId = setTimeout(
        () => {
          setTypedInstall(installCommand.slice(0, typedInstall.length + 1));
        },
        typedInstall.length === 0 ? 500 : 35
      );
      return () => clearTimeout(timeoutId);
    }

    // Extended wait time to admire the generated diagram image
    timeoutId = setTimeout(() => {
      setTypedPlugin("");
      setTypedInstall("");
    }, 4500);
    return () => clearTimeout(timeoutId);
  }, [typedPlugin, typedInstall, pluginLine, isHovering]);

  const showImage = typedInstall.length === installCommand.length;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <section className="relative overflow-hidden rounded-[2rem] border-2 bg-card p-6 shadow-sm sm:p-10">
        <div className="relative z-10 mb-8 flex flex-col items-start justify-between gap-6 sm:flex-row">
          <div className="space-y-3">
            <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
              OpenCode plugin docs
            </h1>
            <p className="max-w-xl text-base text-muted-foreground">
              Add one plugin line in{" "}
              <code className="rounded border bg-muted/50 px-1.5 py-0.5">
                opencode.jsonc
              </code>
              , then run
              <span className="font-medium font-mono text-foreground">
                {" "}
                OpenCode
              </span>{" "}
              to generate Excalidraw diagrams instantly.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-primary/20 bg-primary/10 px-4 py-1.5 font-medium text-primary text-sm shadow-sm transition-colors hover:bg-primary/20">
            v{version}
          </span>
        </div>

        <div className="relative z-10 mb-8 flex flex-wrap items-center gap-4">
          <a
            aria-label="Open npm package"
            className="group flex items-center gap-2 rounded-xl border-2 border-transparent bg-muted/30 px-5 py-2.5 transition-all hover:-translate-y-0.5 hover:-rotate-2 hover:border-foreground/15 hover:bg-muted/50 hover:shadow-sm"
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
            className="group flex items-center gap-2 rounded-xl border-2 border-transparent bg-muted/30 px-5 py-2.5 transition-all hover:-translate-y-0.5 hover:rotate-2 hover:border-foreground/15 hover:bg-muted/50 hover:shadow-sm"
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
            <span className="font-[family-name:var(--font-caveat)] text-foreground/80 text-xl group-hover:text-foreground">
              GitHub
            </span>
          </a>
        </div>

        <div className="relative z-10 grid gap-6 md:grid-cols-[1fr_1.2fr] lg:gap-10">
          <div className="flex flex-col gap-4">
            <section
              aria-label="Animated code block"
              className="overflow-hidden rounded-2xl border-2 border-zinc-200/50 bg-[#1e1e1e] shadow-lg transition-colors dark:border-white/10 dark:bg-[#0d0d0d]"
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
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

            <div className="overflow-hidden rounded-2xl border-2 border-zinc-200/50 bg-[#1e1e1e] shadow-lg dark:border-white/10 dark:bg-[#0d0d0d]">
              <div className="flex items-center border-white/10 border-b bg-white/5 px-4 py-2.5">
                <span className="font-medium text-white/50 text-xs">
                  terminal
                </span>
              </div>
              <div className="p-5">
                <code className="flex min-h-7 items-center font-mono text-sm text-zinc-300">
                  <span className="mr-3 text-[#27c93f]">$</span>
                  <span>{typedInstall}</span>
                  {typedPlugin.length === pluginLine.length &&
                    typedInstall.length < installCommand.length && (
                      <span className="ml-1.5 inline-block h-4 w-2 animate-pulse bg-zinc-300" />
                    )}
                </code>
              </div>
            </div>
          </div>

          <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-muted/30">
            <div
              className={`absolute inset-0 z-0 bg-gradient-to-tr from-primary/5 via-transparent to-primary/10 transition-opacity duration-1000 ${showImage ? "opacity-100" : "opacity-0"}`}
            />

            {!showImage && (
              <div className="flex animate-pulse flex-col items-center gap-3 opacity-50">
                <div className="size-10 animate-spin rounded-full border-4 border-muted-foreground/20 border-t-muted-foreground/60" />
                <span className="font-medium text-muted-foreground text-sm">
                  Awaiting OpenCode magic...
                </span>
              </div>
            )}

            <div
              className={`absolute inset-0 flex items-center justify-center p-4 transition-all duration-700 ease-out ${showImage ? "translate-y-0 scale-100 opacity-100" : "translate-y-8 scale-95 opacity-0"}`}
            >
              <div className="relative h-full w-full overflow-hidden rounded-xl border border-border/50 bg-background shadow-2xl [border-radius:255px_15px_225px_15px/15px_225px_15px_255px]">
                <Image
                  alt="Generated Excalidraw Diagram"
                  className="object-cover object-left-top"
                  fill
                  src="/screenshots/opencode-preview-white.png"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
