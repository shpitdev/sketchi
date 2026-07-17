import "../../../packages/diagram/ui/src/styles.css";
import "../../icons/src/styles/app.css";
import "../../excalidraw/src/styles/app.css";

import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
  parameters: {
    controls: {
      expanded: true,
    },
  },
};

export default preview;
