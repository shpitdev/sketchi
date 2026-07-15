import type { ReactElement, SVGProps } from "react";

/**
 * Hand-drawn action glyphs in the Sketchi sketchbook style — loose strokes,
 * round caps, a little wobble — so the diagram actions feel drawn, not
 * imported. Same aesthetic as the marketing PencilGlyph/ExportGlyph.
 */
export type SketchIconName =
  | "open"
  | "edit"
  | "save"
  | "download"
  | "scene"
  | "drawing"
  | "review"
  | "project"
  | "projects"
  | "playground";

const glyphs: Record<SketchIconName, ReactElement> = {
  // Open in a bigger view — a card with an arrow leaving the corner.
  open: (
    <>
      <path d="M11 5.5H6.5c-1 0-1.6.7-1.6 1.6v10c0 .9.7 1.6 1.6 1.6h10c.9 0 1.6-.7 1.6-1.6V13" />
      <path d="M13.5 4.7h5.6v5.4" />
      <path d="M19 4.9 11.4 12.3" />
    </>
  ),
  // Pencil — the edit affordance.
  edit: (
    <>
      <path d="M14.4 5.2c.6-.6 1.4-.6 2 0l2.3 2.3c.6.6.6 1.5 0 2L9.3 20.8l-4.4 1 1.1-4.3 8.4-8.3z" />
      <path d="m12.9 6.7 3.7 3.7" />
    </>
  ),
  // Bookmark ribbon — save / keep.
  save: (
    <>
      <path d="M6.8 4.6h10.4c.5 0 .8.4.8.9v14.1l-6-4-6 4V5.5c0-.5.3-.9.8-.9z" />
    </>
  ),
  // Tray with a down arrow — download / export.
  download: (
    <>
      <path d="M12 4.3v9.4" />
      <path d="m8.2 10.4 3.8 3.7 3.8-3.7" />
      <path d="M5.2 15.4v3c0 .8.6 1.4 1.4 1.4h10.8c.8 0 1.4-.6 1.4-1.4v-3" />
    </>
  ),
  // Curly braces — the scene / data file.
  scene: (
    <>
      <path d="M9.4 4.9c-1.8 0-1.9 1.3-1.9 3s-.2 3.1-1.7 3.1c1.5 0 1.7 1.4 1.7 3.1s.1 3 1.9 3" />
      <path d="M14.6 4.9c1.8 0 1.9 1.3 1.9 3s.2 3.1 1.7 3.1c-1.5 0-1.7 1.4-1.7 3.1s-.1 3-1.9 3" />
    </>
  ),
  // Framed picture — the drawing / .excalidraw file.
  drawing: (
    <>
      <path d="M5.2 5.4h13.6c.5 0 .9.4.9.9v11.4c0 .5-.4.9-.9.9H5.2c-.5 0-.9-.4-.9-.9V6.3c0-.5.4-.9.9-.9z" />
      <path d="M9.3 10.4a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z" />
      <path d="m4.9 16.6 4.2-4 3.1 3 3.2-3.6 4 4.4" />
    </>
  ),
  // Eye — review / preview.
  review: (
    <>
      <path d="M2.8 12S6 6.2 12 6.2 21.2 12 21.2 12 18 17.8 12 17.8 2.8 12 2.8 12z" />
      <path d="M12 9.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z" />
    </>
  ),
  // Folder — a single project.
  project: (
    <>
      <path d="M4.4 7.3c0-.9.7-1.6 1.6-1.6h3l2 2h7c.9 0 1.6.7 1.6 1.6v7.4c0 .9-.7 1.6-1.6 1.6H6c-.9 0-1.6-.7-1.6-1.6V7.3z" />
    </>
  ),
  // Stacked folders — the projects list.
  projects: (
    <>
      <path d="M7 6.4h2.6l1.7 1.7h5.9c.8 0 1.4.6 1.4 1.4v.6" />
      <path d="M4.4 10c0-.8.6-1.4 1.4-1.4h3l1.7 1.7h6.3c.8 0 1.4.6 1.4 1.4v5.5c0 .8-.6 1.4-1.4 1.4H5.8c-.8 0-1.4-.6-1.4-1.4V10z" />
    </>
  ),
  // A board with a drawn squiggle — back to the playground.
  playground: (
    <>
      <path d="M4.6 5.4h14.8c.4 0 .7.3.7.7v10.5c0 .4-.3.7-.7.7H4.6c-.4 0-.7-.3-.7-.7V6.1c0-.4.3-.7.7-.7z" />
      <path d="M7 13.6c1.6-2.9 2.7-3 3.8-.4.9 2 2 1.4 3.1-.2 1-1.5 2.2-1.4 3.1.5" />
    </>
  ),
};

export interface SketchIconProps extends SVGProps<SVGSVGElement> {
  name: SketchIconName;
}

export function SketchIcon({ name, ...props }: SketchIconProps) {
  return (
    <svg
      aria-hidden="true"
      className="studio__icon-glyph"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width="20"
      {...props}
    >
      {glyphs[name]}
    </svg>
  );
}
