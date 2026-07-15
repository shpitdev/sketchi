import "@sketchi/diagram-studio-ui/styles.css";
import "../src/styles/app.css";

import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
  parameters: {
    controls: {
      expanded: true,
    },
  },
};

export default preview;
