import { families } from "@sketchi/diagrams/family";

/** Wizard options in canonical family order. */
export const GENERATION_TYPE_OPTIONS = families.map((family) => ({
	value: family.type,
	...family.docs.choice,
}));
