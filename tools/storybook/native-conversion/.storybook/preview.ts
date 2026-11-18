import "@sketchi/studio/styles.css";
import "@sketchi/editor-surface/styles.css";

import { type Preview } from "@storybook/react-vite";

const preview: Preview = {
	parameters: {
		controls: {
			expanded: true,
		},
	},
};

export default preview;
