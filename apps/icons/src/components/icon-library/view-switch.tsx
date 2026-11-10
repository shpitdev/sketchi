/** The grid shows each mark's SVG, or its hand-drawn version. */
export type IconView = "drawn" | "svg";

const views = [
	{ label: "SVG", view: "svg" },
	{ label: "Hand-drawn", view: "drawn" },
] as const;

/** Two pressed-state buttons that switch the grid between SVGs and hand-drawn marks. */
export function ViewSwitch({
	onChange,
	value,
}: {
	onChange: (view: IconView) => void;
	value: IconView;
}) {
	return (
		<div aria-label="Icon style" className="view-switch" role="group">
			{views.map(({ label, view }) => (
				<button
					aria-pressed={value === view}
					key={view}
					onClick={() => onChange(view)}
					type="button"
				>
					{label}
				</button>
			))}
		</div>
	);
}
