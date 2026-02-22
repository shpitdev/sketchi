import { ArrowUpRight, Sparkles, Terminal, Wand2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AnimatedSketchiLogo } from "@/components/animated-sketchi-logo";
import { ScreenshotViewer } from "@/components/screenshot-viewer";

type FeatureStatus = "available" | "alpha" | "coming-soon";

interface FeatureCardProps {
  description: string;
  externalHref?: string;
  href?: string;
  icon: React.ReactNode;
  screenshot: {
    light: string;
    dark?: string;
    alt: string;
  };
  status: FeatureStatus;
  statusLabel?: string;
  title: string;
}

function StatusBadge({
  status,
  label,
}: {
  status: FeatureStatus;
  label?: string;
}) {
  const badgeBaseClass =
    "inline-flex items-center gap-1.5 px-2.5 py-0.5 font-medium text-xs border border-current rounded-[255px_15px_225px_15px/15px_225px_15px_255px] shadow-sm";

  if (label) {
    return (
      <span
        className={`${badgeBaseClass} bg-secondary text-secondary-foreground`}
      >
        {label}
      </span>
    );
  }

  if (status === "available") {
    return (
      <span
        className={`${badgeBaseClass} bg-primary/10 text-primary dark:bg-primary/20`}
      >
        <span className="size-1.5 rounded-full bg-primary" />
        Available
      </span>
    );
  }
  if (status === "alpha") {
    return (
      <span
        className={`${badgeBaseClass} bg-chart-3/15 text-chart-3 dark:bg-chart-3/25`}
      >
        <span className="size-1.5 rounded-full bg-chart-3" />
        Alpha
      </span>
    );
  }
  return (
    <span
      className={`${badgeBaseClass} border-muted-foreground/30 bg-muted text-muted-foreground`}
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      Coming soon
    </span>
  );
}

function FeatureCardContent({
  title,
  description,
  status,
  statusLabel,
  icon,
  screenshot,
  isClickable,
  isExternal,
}: FeatureCardProps & { isClickable: boolean; isExternal: boolean }) {
  return (
    <>
      <div className="relative aspect-16/10 w-full overflow-hidden bg-muted/30">
        <Image
          alt={screenshot.alt}
          className={`object-cover object-top transition-transform duration-500 ${
            isClickable ? "group-hover:scale-[1.02]" : ""
          } ${screenshot.dark ? "dark:hidden" : ""}`}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          src={screenshot.light}
        />
        {screenshot.dark && (
          <Image
            alt={screenshot.alt}
            className="hidden object-cover object-top transition-transform duration-500 group-hover:scale-[1.02] dark:block"
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            src={screenshot.dark}
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-card/80 via-transparent to-transparent" />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-foreground/5 text-foreground/70 transition-colors group-hover:bg-foreground/10 group-hover:text-foreground">
              {icon}
            </div>
            <h2 className="font-medium text-base tracking-tight">{title}</h2>
          </div>
          <StatusBadge label={statusLabel} status={status} />
        </div>

        <p className="flex-1 text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>

        {isClickable && (
          <div className="flex items-center gap-2 pt-1">
            <span className="font-(family-name:--font-caveat) inline-flex items-center gap-2 rounded-[255px_15px_225px_15px/15px_225px_15px_255px] border-2 border-primary bg-primary px-4 py-1.5 text-lg text-primary-foreground shadow-sm transition-all group-hover:-rotate-2 group-hover:gap-3 group-hover:bg-primary/90 group-hover:shadow-[3px_3px_0px_0px_currentColor]">
              {isExternal ? "Learn more" : "Open"}
              {isExternal && <ArrowUpRight className="size-4" />}
            </span>
          </div>
        )}

        {status === "coming-soon" && (
          <div className="flex items-center gap-2 pt-1">
            <span className="font-(family-name:--font-caveat) inline-flex items-center gap-2 rounded-[255px_15px_225px_15px/15px_225px_15px_255px] border-2 border-muted-foreground/20 bg-muted px-4 py-1.5 text-lg text-muted-foreground">
              Coming soon
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function FeatureCard(props: FeatureCardProps) {
  const { status, href, externalHref } = props;
  const isClickable = status !== "coming-soon" && (href || externalHref);
  const isExternal = !!externalHref;

  const cardClassName = `group relative flex flex-col overflow-hidden border-2 bg-card transition-all duration-300 rounded-[255px_15px_225px_15px/15px_225px_15px_255px] ${
    isClickable
      ? "cursor-pointer hover:-translate-y-1 hover:-rotate-1 hover:border-foreground/30 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.05)]"
      : "border-dashed opacity-75"
  }`;

  const contentProps = { ...props, isClickable: !!isClickable, isExternal };

  if (isClickable && isExternal && externalHref) {
    return (
      <a
        className={cardClassName}
        href={externalHref}
        rel="noopener noreferrer"
        target="_blank"
      >
        <FeatureCardContent {...contentProps} />
      </a>
    );
  }

  if (isClickable && href) {
    return (
      <Link className={cardClassName} href={href as never}>
        <FeatureCardContent {...contentProps} />
      </Link>
    );
  }

  return (
    <div className={cardClassName}>
      <FeatureCardContent {...contentProps} />
    </div>
  );
}

export default function Home() {
  const features: FeatureCardProps[] = [
    {
      title: "Icon Library Generator",
      description:
        "Transform SVG icons into hand-drawn Excalidraw assets. Upload, customize styles, and export production-ready .excalidrawlib files.",
      status: "available",
      href: "/library-generator",
      icon: <Wand2 className="size-5" />,
      screenshot: {
        light: "/screenshots/library-generator.png",
        alt: "Icon Library Generator interface",
      },
    },
    {
      title: "AI Diagram Generation",
      description:
        "Convert natural language into flowcharts, architecture diagrams, and more. Powered by AI with automatic layout and hand-drawn aesthetics.",
      status: "alpha",
      href: "/diagrams",
      icon: <Sparkles className="size-5" />,
      screenshot: {
        light: "/screenshots/web-based-inline-generator-god-hates-js.png",
        alt: "AI-generated Excalidraw diagram",
      },
    },
    {
      title: "OpenCode Plugin",
      description:
        "Bi-directional human-in-the-loop diagramming for AI agents. Create, modify, and grade diagrams directly from your development workflow.",
      status: "available",
      statusLabel: "v0.0.3",
      href: "/opencode",
      icon: <Terminal className="size-5" />,
      screenshot: {
        dark: "/screenshots/opencode-preview-dark.png",
        light: "/screenshots/opencode-preview-light.png",
        alt: "OpenCode plugin preview",
      },
    },
  ];

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <div className="mx-auto mb-12 flex flex-col items-center gap-4 sm:mb-16">
        <div className="w-full max-w-[420px] transition-all hover:rotate-2 hover:scale-105">
          <AnimatedSketchiLogo className="h-auto w-full" />
        </div>
        <p className="max-w-lg text-center text-muted-foreground text-sm leading-relaxed">
          Transform SVGs into hand-drawn Excalidraw assets. Build icon
          libraries, generate diagrams, and export production-ready files.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <FeatureCard key={feature.title} {...feature} />
        ))}
      </div>

      <section aria-label="More screenshots" className="mt-10 sm:mt-14">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-medium text-foreground/90 text-sm">
            More screenshots
          </h2>
          <p className="hidden text-muted-foreground text-xs sm:block">
            Click to explore
          </p>
        </div>
        <ScreenshotViewer />
      </section>
    </div>
  );
}
