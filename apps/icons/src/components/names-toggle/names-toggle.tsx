import { CaseSensitive } from "lucide-react";

/** A pressed-state button that writes each icon's name under its drawing. */
export function NamesToggle({
	onChange,
	value,
}: {
	onChange: (named: boolean) => void;
	value: boolean;
}) {
	return (
		<button
			aria-pressed={value}
			className="names-toggle"
			onClick={() => onChange(!value)}
			type="button"
		>
			<CaseSensitive aria-hidden="true" />
			<span>Names</span>
		</button>
	);
}
