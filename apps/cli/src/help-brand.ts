const PENCIL_LINES = [
  "    /\\",
  "   /  \\",
  "  /____\\",
  "  |    |",
  "  |____|",
];
const WORDMARK_ROW = 1;

const BRAND_PINK = { red: 143, green: 112, blue: 127, ansi256: 95 };
const EGGSHELL = { red: 246, green: 241, blue: 231, ansi256: 255 };
const CHARCOAL = { red: 26, green: 23, blue: 18, ansi256: 234 };

export interface HelpBrandOptions {
  readonly colors: "none" | "ansi256" | "truecolor";
  readonly background: "dark" | "light";
}

function foreground(
  text: string,
  color: typeof BRAND_PINK,
  mode: HelpBrandOptions["colors"],
): string {
  if (mode === "none") return text;
  const code =
    mode === "truecolor"
      ? `38;2;${String(color.red)};${String(color.green)};${String(color.blue)}`
      : `38;5;${String(color.ansi256)}`;
  return `\u001b[${code}m${text}\u001b[0m`;
}

export function renderHelpBrand(options: HelpBrandOptions): string {
  const wordmarkColor = options.background === "dark" ? EGGSHELL : CHARCOAL;
  return PENCIL_LINES.map((line, index) => {
    const pencil = foreground(line, BRAND_PINK, options.colors);
    return index === WORDMARK_ROW
      ? `${pencil}   ${foreground("sketchi", wordmarkColor, options.colors)}`
      : pencil;
  }).join("\n");
}

function terminalBackground(): HelpBrandOptions["background"] {
  const colorForegroundBackground = process.env["COLORFGBG"];
  const background = colorForegroundBackground?.split(";").at(-1);
  if (!background || !/^\d+$/u.test(background)) return "dark";
  const index = Number(background);
  if (index < 16) {
    return index === 7 || index >= 9 ? "light" : "dark";
  }
  if (index < 232) {
    const channel = [0, 95, 135, 175, 215, 255];
    const offset = index - 16;
    const red = channel[Math.floor(offset / 36)] ?? 0;
    const green = channel[Math.floor((offset % 36) / 6)] ?? 0;
    const blue = channel[offset % 6] ?? 0;
    return red * 299 + green * 587 + blue * 114 >= 128_000 ? "light" : "dark";
  }
  return 8 + (index - 232) * 10 >= 128 ? "light" : "dark";
}

export function terminalHelpBrand(): string {
  if (
    process.env["NO_COLOR"] !== undefined ||
    process.env["TERM"] === "dumb" ||
    process.stdout.isTTY !== true
  ) {
    return renderHelpBrand({
      colors: "none",
      background: terminalBackground(),
    });
  }
  return renderHelpBrand({
    colors: process.stdout.hasColors(2 ** 24) ? "truecolor" : "ansi256",
    background: terminalBackground(),
  });
}
