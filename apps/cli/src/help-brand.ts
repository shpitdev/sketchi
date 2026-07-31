import { Chalk } from "chalk";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

// These silhouettes follow the down-left nib and up-right barrel of the
// product icon in apps/web/public/icon.svg. The ASCII version is deliberately
// structural rather than a transliteration of box-drawing characters.
const UNICODE_PENCIL = [
  "              ╱██╲",
  "             ╱████╲",
  "            ╱████╱",
  "           ╱████╱",
  "          ╱████╱",
  "         ╱___╱",
  "        ◢",
] as const;

const ASCII_PENCIL = [
  "              /##\\",
  "             /####\\",
  "            /####/",
  "           /####/",
  "          /####/",
  "         /___/",
  "        /_",
] as const;

const BRAND = {
  dark: { red: 195, green: 154, blue: 172, ansi256: 181 },
  light: { red: 111, green: 84, blue: 98, ansi256: 95 },
} as const;
const FOREGROUND = {
  dark: { red: 246, green: 241, blue: 231, ansi256: 255 },
  light: { red: 26, green: 23, blue: 18, ansi256: 234 },
} as const;
const MUTED = {
  dark: { red: 216, green: 204, blue: 177, ansi256: 187 },
  light: { red: 76, green: 70, blue: 57, ansi256: 239 },
} as const;

interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

interface Color extends RgbColor {
  readonly ansi256: number;
}

const ANSI_COLORS = [
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  [127, 127, 127],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [92, 92, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
] as const;
const MINIMUM_TEXT_CONTRAST = 4.5;

export interface HelpBrandOptions {
  readonly colors: "none" | "ansi256" | "truecolor";
  readonly background: "dark" | "light";
  readonly unicode?: boolean;
  readonly width?: number;
}

function styled(
  text: string,
  color: Color,
  options: HelpBrandOptions,
  emphasis: "plain" | "bold" = "plain",
): string {
  if (options.colors === "none") return text;
  const chalk = new Chalk({ level: options.colors === "truecolor" ? 3 : 2 });
  const paint =
    options.colors === "truecolor"
      ? chalk.rgb(color.red, color.green, color.blue)
      : chalk.ansi256(color.ansi256);
  return emphasis === "bold" ? paint.bold(text) : paint(text);
}

function heading(text: string, options: HelpBrandOptions): string {
  return styled(text, BRAND[options.background], options, "bold");
}

function command(text: string, options: HelpBrandOptions): string {
  return styled(text, FOREGROUND[options.background], options, "bold");
}

function description(text: string, options: HelpBrandOptions): string {
  return styled(text, MUTED[options.background], options);
}

function brandLockup(options: HelpBrandOptions): string {
  const pencil = options.unicode === false ? ASCII_PENCIL : UNICODE_PENCIL;
  const width = Math.max(32, options.width ?? 80);
  const indent = width < 40 ? "  " : "        ";
  return [
    ...pencil.map((line) => styled(line, BRAND[options.background], options)),
    "",
    `${indent}${styled("sketchi", FOREGROUND[options.background], options, "bold")}`,
    wrappedLine(
      indent,
      description("describe it. sketchi draws it.", options),
      width,
    ),
  ].join("\n");
}

function wrappedLine(
  prefix: string,
  text: string,
  width: number,
  continuationIndent = stringWidth(prefix),
): string {
  const available = Math.max(16, width - stringWidth(prefix));
  return `${prefix}${wrapAnsi(text, available, {
    hard: true,
    trim: true,
  }).replaceAll("\n", `\n${" ".repeat(continuationIndent)}`)}`;
}

function action(
  name: string,
  text: string,
  options: HelpBrandOptions,
  width: number,
  labelWidth = 8,
): string {
  if (width < 52) {
    return [
      `  ${command(name, options)}`,
      wrappedLine("    ", description(text, options), width),
    ].join("\n");
  }
  const label = name.padEnd(labelWidth);
  const prefix = `  ${command(label, options)}  `;
  return wrappedLine(prefix, description(text, options), width);
}

export function renderRootHelp(options: HelpBrandOptions): string {
  const width = Math.max(32, options.width ?? 80);
  const example =
    'sketchi generate --prompt "Map release approval with pass and revise branches"';
  return [
    brandLockup(options),
    "",
    heading("START HERE", options),
    action(
      "generate",
      "Start the short wizard, or pass --prompt for direct generation.",
      options,
      width,
    ),
    "",
    heading("EXAMPLE", options),
    wrappedLine("  ", command(example, options), width),
    wrappedLine(
      "  ",
      description(
        "Writes <generated-id>.png in this directory. No account or API key needed.",
        options,
      ),
      width,
    ),
    "",
    heading("WORK WITH A DIAGRAM", options),
    action("show", "Inspect a local diagram.", options, width),
    action("edit", "Replace its canonical document.", options, width),
    action("export", "Write PNG, Excalidraw, or scene bytes.", options, width),
    action("share", "Create an encrypted Excalidraw link.", options, width),
    "",
    heading("GO DEEPER", options),
    action(
      "sketchi docs",
      "Complete command map and automation contracts.",
      options,
      width,
      26,
    ),
    action(
      "sketchi generate --help",
      "Every generation option.",
      options,
      width,
      26,
    ),
    action(
      "sketchi <command> --help",
      "Targeted help for any command.",
      options,
      width,
      26,
    ),
    "",
    wrappedLine(
      "",
      description(
        "Automation: pass --prompt and add --output json.  Version: sketchi --version",
        options,
      ),
      width,
    ),
  ].join("\n");
}

function ansiColor(index: number): RgbColor | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
  if (index < 16) {
    const [red, green, blue] = ANSI_COLORS[index] ?? [0, 0, 0];
    return { red, green, blue };
  }
  if (index < 232) {
    const channel = [0, 95, 135, 175, 215, 255];
    const offset = index - 16;
    const red = channel[Math.floor(offset / 36)] ?? 0;
    const green = channel[Math.floor((offset % 36) / 6)] ?? 0;
    const blue = channel[offset % 6] ?? 0;
    return { red, green, blue };
  }
  const channel = 8 + (index - 232) * 10;
  return { red: channel, green: channel, blue: channel };
}

function relativeLuminance(color: RgbColor): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (
    linear(color.red) * 0.2126 +
    linear(color.green) * 0.7152 +
    linear(color.blue) * 0.0722
  );
}

function contrast(first: RgbColor, second: RgbColor): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function minimumPaletteContrast(
  background: RgbColor,
  palette: HelpBrandOptions["background"],
  colors: Exclude<HelpBrandOptions["colors"], "none">,
): number {
  const emittedColor = (color: Color): RgbColor =>
    colors === "truecolor" ? color : (ansiColor(color.ansi256) ?? color);
  return Math.min(
    contrast(background, emittedColor(BRAND[palette])),
    contrast(background, emittedColor(FOREGROUND[palette])),
    contrast(background, emittedColor(MUTED[palette])),
  );
}

interface TerminalPalette {
  readonly background: HelpBrandOptions["background"];
  readonly readable: boolean;
}

export function terminalPaletteForBackground(
  index: number,
  colors: Exclude<HelpBrandOptions["colors"], "none">,
): TerminalPalette {
  const backgroundColor = ansiColor(index);
  if (backgroundColor === undefined)
    return { background: "dark", readable: false };

  const darkContrast = minimumPaletteContrast(backgroundColor, "dark", colors);
  const lightContrast = minimumPaletteContrast(
    backgroundColor,
    "light",
    colors,
  );
  const background = darkContrast >= lightContrast ? "dark" : "light";
  return {
    background,
    readable: Math.max(darkContrast, lightContrast) >= MINIMUM_TEXT_CONTRAST,
  };
}

function terminalPalette(
  colors: Exclude<HelpBrandOptions["colors"], "none">,
): TerminalPalette {
  const colorForegroundBackground = process.env["COLORFGBG"];
  const background = colorForegroundBackground?.split(";").at(-1);
  if (!background || !/^\d+$/u.test(background)) {
    return { background: "dark", readable: false };
  }
  return terminalPaletteForBackground(Number(background), colors);
}

export function terminalRootHelp(): string {
  const width =
    process.stdout.columns === undefined || process.stdout.columns <= 0
      ? 80
      : process.stdout.columns;
  const unicode = terminalSupportsUnicode();
  if (
    process.env["NO_COLOR"] !== undefined ||
    process.env["TERM"] === "dumb" ||
    process.env["TERM"] === "ansi" ||
    process.stdout.isTTY !== true
  ) {
    return renderRootHelp({
      colors: "none",
      background: "dark",
      unicode,
      width,
    });
  }
  const colors = process.stdout.hasColors(2 ** 24)
    ? "truecolor"
    : process.stdout.hasColors(256)
      ? "ansi256"
      : "none";
  if (colors === "none") {
    return renderRootHelp({
      colors: "none",
      background: "dark",
      unicode,
      width,
    });
  }
  const palette = terminalPalette(colors);
  if (!palette.readable) {
    return renderRootHelp({
      colors: "none",
      background: palette.background,
      unicode,
      width,
    });
  }
  return renderRootHelp({
    colors,
    background: palette.background,
    unicode,
    width,
  });
}

export function terminalSupportsUnicode(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment["TERM"] === "dumb" || environment["TERM"] === "linux") {
    return false;
  }
  const locale = [
    environment["LC_ALL"],
    environment["LC_CTYPE"],
    environment["LANG"],
  ].find((value) => value !== undefined && value.length > 0);
  return locale !== undefined && /(?:^|[._-])utf-?8(?:@|$)/iu.test(locale);
}
