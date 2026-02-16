# @sketchi-app/opencode-excalidraw

OpenCode plugin for generating and manipulating Excalidraw diagrams via Sketchi.

## Install

- npm: `npm i @sketchi-app/opencode-excalidraw`

## Usage

The plugin exposes tools:

- `diagram_from_prompt`
- `diagram_tweak`
- `diagram_restructure`
- `diagram_to_png`
- `diagram_grade`

Optional override:

- `SKETCHI_API_URL` (defaults to `https://sketchi.app`)

## Playwright

This plugin renders PNGs locally using Playwright.

If you see browser/runtime errors, install browsers:

- `npx playwright install`

