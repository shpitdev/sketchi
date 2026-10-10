import { Chalk, type ChalkInstance } from "chalk";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

// A 16x16 pixel icon drawn for the terminal, painted two pixel rows per cell
// with half blocks. The product icon in apps/web/public/icon.svg is a hairline
// pencil outline that dissolves below ~64px, so this redraws the same subject
// as solid material bands — graphite nib, wood bevel, barrel, ferrule, eraser —
// on the brand plate. Legend: space plate cut-out, p plate, k graphite, w wood,
// c barrel, f ferrule, e eraser.
const PENCIL_TILE = [
	"  pppppppppppp  ",
	" pppppppppppppp ",
	"pppppppppppeeppp",
	"ppppppppppfeeepp",
	"pppppppppcffeepp",
	"ppppppppcccffppp",
	"pppppppcccccpppp",
	"ppppppcccccppppp",
	"pppppcccccpppppp",
	"ppppwccccppppppp",
	"pppwwwccpppppppp",
	"pppkwwwppppppppp",
	"pppkkwpppppppppp",
	"pppppppppppppppp",
	" pppppppppppppp ",
	"  pppppppppppp  ",
] as const;

// 8 rows tall so it pairs with the tile at four half-block cells.
const WORDMARK_GLYPHS: Readonly<Record<string, readonly string[]>> = {
	s: ["....", "....", ".###", "#...", ".##.", "...#", "###.", "...."],
	k: ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#", "...."],
	e: ["....", "....", ".##.", "#..#", "####", "#...", ".###", "...."],
	t: [".#.", ".#.", "###", ".#.", ".#.", ".#.", ".##", "..."],
	c: ["....", "....", ".###", "#...", "#...", "#...", ".###", "...."],
	h: ["#...", "#...", "#.#.", "##.#", "#..#", "#..#", "#..#", "...."],
	i: ["#", ".", "#", "#", "#", "#", "#", "."],
};

const TILE_MATERIALS: Readonly<Record<string, Record<HelpBrandOptions["background"], Color>>> = {
	p: {
		dark: { red: 158, green: 124, blue: 140, ansi256: 138 },
		light: { red: 143, green: 112, blue: 127, ansi256: 96 },
	},
	c: {
		dark: { red: 250, green: 248, blue: 247, ansi256: 231 },
		light: { red: 250, green: 248, blue: 247, ansi256: 231 },
	},
	w: {
		dark: { red: 214, green: 186, blue: 152, ansi256: 180 },
		light: { red: 214, green: 186, blue: 152, ansi256: 180 },
	},
	k: {
		dark: { red: 58, green: 50, blue: 54, ansi256: 237 },
		light: { red: 58, green: 50, blue: 54, ansi256: 237 },
	},
	f: {
		dark: { red: 186, green: 190, blue: 196, ansi256: 250 },
		light: { red: 186, green: 190, blue: 196, ansi256: 250 },
	},
	e: {
		dark: { red: 222, green: 152, blue: 158, ansi256: 175 },
		light: { red: 222, green: 152, blue: 158, ansi256: 175 },
	},
};

const TILE_WIDTH = 16;
const LOCKUP_GAP = 2;
const TAGLINE = "describe it. sketchi draws it.";

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

function painter(options: HelpBrandOptions) {
	const chalk = new Chalk({
		level: options.colors === "none" ? 0 : options.colors === "truecolor" ? 3 : 2,
	});
	const foreground = (color: Color, base: ChalkInstance = chalk) =>
		options.colors === "truecolor"
			? base.rgb(color.red, color.green, color.blue)
			: base.ansi256(color.ansi256);
	const background = (color: Color) =>
		options.colors === "truecolor"
			? chalk.bgRgb(color.red, color.green, color.blue)
			: chalk.bgAnsi256(color.ansi256);
	const text = (value: string, color: Color, bold = false) => {
		const ink = foreground(color);
		return bold ? ink.bold(value) : ink(value);
	};
	return {
		foreground,
		pair: (top: Color, bottom: Color) => foreground(top, background(bottom))("▀"),
		heading: (value: string) => text(value, BRAND[options.background], true),
		command: (value: string) => text(value, FOREGROUND[options.background], true),
		description: (value: string) => text(value, MUTED[options.background]),
	};
}

type Painter = ReturnType<typeof painter>;

function tileColor(pixel: string, options: HelpBrandOptions): Color | undefined {
	const material = TILE_MATERIALS[pixel];
	return material === undefined ? undefined : material[options.background];
}

// Two pixel rows per cell: the upper half block carries the top pixel as
// foreground and the lower pixel as background, so square pixels stay square.
function tileRows(options: HelpBrandOptions, colors: Painter): readonly string[] {
	const rows: string[] = [];
	for (let y = 0; y < PENCIL_TILE.length; y += 2) {
		let row = "";
		for (let x = 0; x < TILE_WIDTH; x += 1) {
			const top = tileColor(PENCIL_TILE[y]?.[x] ?? " ", options);
			const bottom = tileColor(PENCIL_TILE[y + 1]?.[x] ?? " ", options);
			if (top === undefined && bottom === undefined) row += " ";
			else if (top === undefined && bottom !== undefined) row += colors.foreground(bottom)("▄");
			else if (top !== undefined && bottom === undefined) row += colors.foreground(top)("▀");
			else if (top !== undefined && bottom !== undefined) row += colors.pair(top, bottom);
		}
		rows.push(row);
	}
	return rows;
}

function wordmarkRows(options: HelpBrandOptions, colors: Painter): readonly string[] {
	const pixels = Array.from({ length: 8 }, (_, y) =>
		[..."sketchi"]
			.map(
				(character, index) => `${WORDMARK_GLYPHS[character]?.[y] ?? ""}${index === 6 ? "" : "."}`,
			)
			.join(""),
	);
	const ink = FOREGROUND[options.background];
	const rows: string[] = [];
	for (let y = 0; y < pixels.length; y += 2) {
		let row = "";
		for (let x = 0; x < (pixels[y]?.length ?? 0); x += 1) {
			const top = pixels[y]?.[x] === "#";
			const bottom = pixels[y + 1]?.[x] === "#";
			row += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
		}
		rows.push(options.colors === "none" ? row : colors.foreground(ink)(row));
	}
	return rows;
}

const WORDMARK_WIDTH = 30;

function brandLockup(options: HelpBrandOptions, colors: Painter): string {
	const width = Math.max(32, options.width ?? 80);
	const tagline = wrappedLine("  ", colors.description(TAGLINE), width);

	// The mark is a colour asset. Pipes, NO_COLOR and non-UTF-8 locales get the
	// word itself rather than block art that would be noise there.
	if (options.colors === "none" || options.unicode === false) {
		return [`  ${colors.command("sketchi")}`, tagline].join("\n");
	}

	const wordmark = wordmarkRows(options, colors);
	if (width < 2 + TILE_WIDTH + LOCKUP_GAP + WORDMARK_WIDTH) {
		return [...wordmark.map((row) => `  ${row}`), "", tagline].join("\n");
	}

	// Centre the four-cell wordmark against the eight-cell tile.
	const tile = tileRows(options, colors);
	const offset = (tile.length - wordmark.length) / 2;
	const gap = " ".repeat(LOCKUP_GAP);
	return [
		...tile.map((row, index) => {
			const beside = wordmark[index - offset];
			return `  ${row}${beside === undefined ? "" : `${gap}${beside}`}`;
		}),
		"",
		tagline,
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
	colors: Painter,
	width: number,
	labelWidth = 8,
): string {
	if (width < 52) {
		return [`  ${colors.command(name)}`, wrappedLine("    ", colors.description(text), width)].join(
			"\n",
		);
	}
	const label = name.padEnd(labelWidth);
	const prefix = `  ${colors.command(label)}  `;
	return wrappedLine(prefix, colors.description(text), width);
}

export function renderRootHelp(options: HelpBrandOptions): string {
	const colors = painter(options);
	const width = Math.max(32, options.width ?? 80);
	const example = 'sketchi generate --prompt "Map release approval with pass and revise branches"';
	return [
		brandLockup(options, colors),
		"",
		colors.heading("START HERE"),
		wrappedLine(
			`  ${colors.command("sketchi generate")}  `,
			colors.description("interactive"),
			width,
		),
		wrappedLine("  ", colors.command(example), width),
		wrappedLine(
			"  ",
			colors.description(
				"Writes <generated-id>.png in this directory. No account or API key needed.",
			),
			width,
		),
		action("canvas", "Build and export a typed Universal CanvasSpec.", colors, width),
		"",
		colors.heading("WORK WITH A DIAGRAM"),
		action("show", "Inspect a local diagram.", colors, width),
		action("edit", "Replace its canonical document.", colors, width),
		action("export", "Write PNG, Excalidraw, or scene bytes.", colors, width),
		action("share", "Create an encrypted Excalidraw link.", colors, width),
		"",
		wrappedLine(
			"",
			colors.description("sketchi docs for every command.  Add --output json for automation."),
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
	return linear(color.red) * 0.2126 + linear(color.green) * 0.7152 + linear(color.blue) * 0.0722;
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
	if (backgroundColor === undefined) return { background: "dark", readable: false };

	const darkContrast = minimumPaletteContrast(backgroundColor, "dark", colors);
	const lightContrast = minimumPaletteContrast(backgroundColor, "light", colors);
	const background = darkContrast >= lightContrast ? "dark" : "light";
	return {
		background,
		readable: Math.max(darkContrast, lightContrast) >= MINIMUM_TEXT_CONTRAST,
	};
}

// COLORFGBG is a courtesy hint that only a minority of terminals set, so its
// absence must not disable colour — it only means we cannot detect a light
// background and fall back to the dark palette.
function terminalPalette(colors: Exclude<HelpBrandOptions["colors"], "none">): TerminalPalette {
	const colorForegroundBackground = process.env["COLORFGBG"];
	const background = colorForegroundBackground?.split(";").at(-1);
	if (!background || !/^\d+$/u.test(background)) {
		return { background: "dark", readable: true };
	}
	return terminalPaletteForBackground(Number(background), colors);
}

export function terminalRootHelp(): string {
	const width =
		process.stdout.columns === undefined || process.stdout.columns <= 0
			? 80
			: process.stdout.columns;
	const unicode = terminalSupportsUnicode();
	const disabled =
		process.env["NO_COLOR"] !== undefined ||
		process.env["TERM"] === "dumb" ||
		process.env["TERM"] === "ansi" ||
		process.stdout.isTTY !== true;
	const colors = disabled
		? "none"
		: process.stdout.hasColors(2 ** 24)
			? "truecolor"
			: process.stdout.hasColors(256)
				? "ansi256"
				: "none";
	const palette =
		colors === "none"
			? ({ background: "dark", readable: true } satisfies TerminalPalette)
			: terminalPalette(colors);
	return renderRootHelp({
		colors: palette.readable ? colors : "none",
		background: palette.background,
		unicode,
		width,
	});
}

export function terminalSupportsUnicode(environment: NodeJS.ProcessEnv = process.env): boolean {
	if (environment["TERM"] === "dumb" || environment["TERM"] === "linux") {
		return false;
	}
	const locale = [environment["LC_ALL"], environment["LC_CTYPE"], environment["LANG"]].find(
		(value) => value !== undefined && value.length > 0,
	);
	return locale !== undefined && /(?:^|[._-])utf-?8(?:@|$)/iu.test(locale);
}
