import { ApiReference } from "@scalar/nextjs-api-reference";

export const GET = ApiReference({
  url: "/api/openapi",
  theme: "bluePlanet",
  layout: "modern",
  defaultOpenAllTags: true,
  hideClientButton: false,
  showSidebar: true,
  hideModels: false,
  hideTestRequestButton: false,
  hideSearch: false,
  showOperationId: false,
  hideDarkModeToggle: false,
  withDefaultFonts: true,
  expandAllModelSections: false,
  expandAllResponses: false,
  // Using explicit known types to avoid potential TS errors with "localhost" etc.
  metaData: {
    title: "Sketchi API",
  },
});
