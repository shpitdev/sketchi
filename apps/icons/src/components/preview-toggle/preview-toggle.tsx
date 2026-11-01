import { Moon, Sun } from "lucide-react";

export type PreviewMode = "dark" | "light";

const modes = [
	{ Icon: Sun, label: "Light preview", mode: "light" },
	{ Icon: Moon, label: "Dark preview", mode: "dark" },
] as const;

/** Two pressed-state buttons that switch the background behind every icon. */
export function PreviewToggle({
	onChange,
	value,
}: {
	onChange: (mode: PreviewMode) => void;
	value: PreviewMode;
}) {
	return (
		<div aria-label="Preview background" className="preview-toggle" role="group">
			{modes.map(({ Icon, label, mode }) => (
				<button
					aria-label={label}
					aria-pressed={value === mode}
					key={mode}
					onClick={() => onChange(mode)}
					title={label}
					type="button"
				>
					<Icon aria-hidden="true" />
				</button>
			))}
		</div>
	);
}
