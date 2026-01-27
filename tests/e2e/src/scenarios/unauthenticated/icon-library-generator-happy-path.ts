/*
Scenario: Icon library generator happy path

Intent: Validate create → upload SVGs → reorder → export → delete flow.

Steps:
- Visit home page and navigate to Icon Library Generator.
- Create a new library with a unique name.
- Upload 3 known-good SVG fixtures.
- Reorder icons (move last to first).
- Export .excalidrawlib and confirm download starts.
- Delete one icon and confirm count updates.

Success:
- Library page loads and shows 3 icons after upload.
- Reorder persists (icon order changes and remains after reload).
- Export initiates download with .excalidrawlib extension.
- Delete removes icon and count updates.
*/
