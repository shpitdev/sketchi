import { LATEST_DIAGRAM } from "../diagram-catalog";
import { Argument, Command, Flag } from "../terminal/effect-cli";

const HUMAN_HELP = "Turn one prompt into a validated PNG and editable local diagram.";

const outputFlag = Flag.Literals("output", ["text", "json"]).pipe(
	Flag.withDefault("text"),
	Flag.withDescription("Result presentation format."),
	Flag.withMetavar("text|json"),
);

export const rootCommand = Command.make("sketchi").pipe(
	Command.withSharedFlags({ output: outputFlag }),
	Command.withDescription(HUMAN_HELP),
	Command.withShortDescription("Turn a prompt into a validated PNG and editable local diagram."),
);

export const diagramIdArgument = Argument.String("diagram-id").pipe(
	Argument.withDescription(
		`A stored id, a unique prefix of one, or ${LATEST_DIAGRAM} for the newest.`,
	),
);
