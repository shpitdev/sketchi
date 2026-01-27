/*
Scenario: Icon library generator invalid SVG handling

Intent: Ensure invalid SVG uploads are rejected without breaking the editor.

Steps:
- Visit Icon Library Generator.
- Create a new library.
- Attempt to upload an invalid SVG (malformed or non-SVG file renamed .svg).

Success:
- UI shows a clear error toast.
- No icons are added to the grid.
- Editor remains usable (upload valid SVG afterward works).
*/
