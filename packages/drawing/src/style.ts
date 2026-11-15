import { Effect, Schema } from "effect";
export const SKETCHI_DIAGRAM_PALETTE = Object.freeze({
	paper: "#f6f1e7",
	card: "#fffdf8",
	ink: "#1a1712",
	accent: "#8f707f",
});
export const SKETCHI_DIAGRAM_STYLE = Object.freeze({
	accentColor: SKETCHI_DIAGRAM_PALETTE.accent,
	backgroundColor: SKETCHI_DIAGRAM_PALETTE.card,
});
const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));
export const DiagramStyle = Schema.Struct({
	accentColor: HexColor.pipe(
		Schema.withDecodingDefault(Effect.succeed(SKETCHI_DIAGRAM_STYLE.accentColor)),
	),
	backgroundColor: HexColor.pipe(
		Schema.withDecodingDefault(Effect.succeed(SKETCHI_DIAGRAM_STYLE.backgroundColor)),
	),
}).annotate({ identifier: "DiagramStyle" });
export interface DiagramStyle extends Schema.Schema.Type<typeof DiagramStyle> {}
export const CHART_SERIES_COLORS = [
	"#2a78d6",
	"#eb6834",
	"#1baf7a",
	"#eda100",
	"#e87ba4",
	"#008300",
	"#6250d6",
	"#e34948",
] as const;
