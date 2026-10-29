# Wireframes

A wireframe draws low-fidelity UI screens: each screen a frame the size of its device, holding a tree of components the renderer lays out. It is a canonical family (`wireframe`), built with `sketchi.buildWireframe`, Studio's `build_wireframe`, `POST /api/v1/wireframes/build`, `sketchi create`, or `generate --type wireframe`.

```json
{"type":"wireframe","spec":{"title":"Login","screens":[{"name":"Login","device":"mobile","children":[{"type":"heading","text":"Welcome back"},{"type":"input","label":"Email","placeholder":"you@example.com"},{"type":"input","label":"Password"},{"type":"checkbox","label":"Remember me","checked":true},{"type":"button","text":"Sign in","variant":"primary"},{"type":"link","text":"Forgot password?"}]}]}}
```

## Contract

- A wireframe has up to 6 `screens`. A screen has a unique `id` (no colon; Code Mode takes one from its name), a `name`, a `device` (`desktop`, the default, `tablet` or `mobile`) and `children`, its components in reading order. Every component tree sits under a screen.
- Containers hold `children`: `header`, `footer`, `sidebar` (`side: "left" | "right"`), `main`, `section`, `card`, `modal`, `row`, `column` and `grid` (`columns`: 1 to 6). Any container may carry a `title`; `align` places its children (`start`, `center` or `end`, and `between` for a row, header or footer).
- Widgets draw from their own fields:
  - `heading` (`text`, `level` 1 to 3), `text` (`text`, or `lines` of placeholder copy when it has none), `link`, `badge` and `button` (`text`; a button's `variant` is `primary` or `secondary`);
  - `input`, `textarea`, `select` and `search` (`label`, `placeholder`, or the `value` they show filled in; a text area's `rows`), `checkbox`, `radio` and `toggle` (`label`, `checked`);
  - `tabs`, `nav` and `breadcrumbs` (`items`, and the `active` tab or nav item), `list` (`items`);
  - `avatar`, `icon`, `image` (`aspect`: `wide`, `square` or `tall`), `chart` (`kind`: `bar`, `line` or `pie`) and their `label`, `table` (`columns`, its headers, and up to 8 placeholder `rows`), and `divider`.
  - `disabled: true` greys out a control, and `target` on a button or link names the screen it opens.
- No field takes a coordinate or a size.
- Code Mode and generation also read `pages` or `views` for screens, a lone screen's components written at the top, `title` for a screen's name, `components` or `elements` for children, `phone` or `web` for a device, type names such as `paragraph`, `h2`, `dialog`, `dropdown`, `switch`, `text-field` and `search-bar`, each widget's words under whichever of `text`, `label` or `title` it names them, items written as objects (`{ label, active: true }`), `primary: true` on a button, `on` or `selected` for `checked`, and a select's `options` (dropped; a closed select shows only its value).
- Validation rejects a widget without the words it shows, tabs, navs, lists or tables without items or columns, an `active` item that is not an item, a field on a component it does not apply to, an empty row, column, grid or screen, a colon in or a repeat of a screen id, texts over 60 characters (80 for headings, 280 for paragraphs), more than 6 screens, 160 components, 12 items, 8 table columns or rows, or 8 levels of nesting, and a wireframe that would draw more than one scene holds. Each rejection carries a repair hint.

## Layout

- The renderer owns every position, in a flex-like box model. Each component reports the narrowest width at which nothing overflows and the width it takes hugging its content; widths pass down and heights come back up.
- A screen's header spans its top and its footer its bottom; sidebars (240 wide on a desktop, 200 on a tablet) run down their sides between them; on a phone a sidebar stacks into the content. A modal at a screen's top level floats centered over a dimmed backdrop. Everything else stacks down the content area.
- Columns stack their children on a spacing scale (4, 8, 12, 16, 24 and 32). Fields, headings, text, images, charts and tables stretch to their column; buttons, links and badges hug their text; a column that centers or ends its children keeps each at its own width.
- Rows set their children side by side, the stretching ones sharing what is left evenly, and wrap onto new lines rather than overflow. Grids split evenly and drop a column whenever a child would not fit its cell. Cards, sections and columns in one row or grid line share its height.
- Text wraps at whole words. A heading or title steps its size down before a word too long for its box would overflow; a table too narrow for its columns stacks each row's fields, header beside a value line. A screen widens past its device only when one word fits nowhere else (no screen in the fuzz does).
- On a phone, every control is at least 44 tall.
- Screens sit side by side in reading order, as many to a row as keeps the sheet no wider than 2.45:1, balanced over those rows (four desktop screens sit two by two).

## Navigation

- A button or link with `target` opens another screen. It draws as an arrow from the control's side to the edge of that screen's frame, bound to both: a straight line to the next screen, and a route around anything in its way otherwise.
- The route is the cheapest orthogonal path on a grid through every obstacle's edges and the middle of every channel between them. It keeps clear of every other screen, every screen's name, and everything on the control's own screen but the containers around it (and, from a modal, what its backdrop dims). Each bend costs, the last stretch runs straight so the head has room, and later arrows keep off earlier ones.
- A link binds its arrow to an invisible box behind its words. Code Mode and generation also read `goTo`, `navigatesTo`, `href` and the like, and a target written as a screen's name or as `#id`.
- Validation rejects a target that names no screen, or the control's own screen. A control boxed in on every side by other components draws no arrow.

## Excalidraw

- Each screen is a named frame the size of its device; every element of a screen sits in its frame.
- Each widget is a group, and a header, footer, sidebar, section, card or modal groups everything inside it, so a card drags as one; layout-only rows, columns and grids add no group.
- The look is the low-fidelity vocabulary in Excalidraw's hand-drawn style: greyscale, with one accent (`#1971c2`) for primary buttons, links, active tabs and nav items, and what is checked or on. Images are boxes with a cross, paragraphs without text are placeholder lines, charts are generic bar, line or pie glyphs, and tables have headers and placeholder rows.
- Buttons and avatars bind their labels. Widget shapes carry the `wireframe-widget` role (corners rounded at most 8) and screen regions, tables, images and charts the `wireframe-region` role (square corners), so none draws a generated label.

## Scenarios

`mobile-login-wireframe`, `saas-dashboard-wireframe` (the challenge: a dense desktop with long labels), `account-settings-wireframe`, `product-page-wireframe` and `signup-flow-wireframe` (three phone screens, each Continue opening the next) take their prompts from frontierclimb's eval draft. Checks score the model's own diagram: `screen:` and `device:` for every stated screen, `component:` for every stated component of a kind that draws it and showing its words (when none is drawn, a container's title stands in for a stated heading or text inside it, and adjacent links for a stated nav, their words its items), `inside:` for its stated container at any depth, `state:` for stated variants, checked states, active items and shown values, `order:` for stated reading orders, items, tabs and breadcrumbs, `columns:` and `list:` for tables and lists, `side:` for stated sides and for what the prompt places at the bottom of a screen (in its footer), `navigation:<screen>-><screen>` for each stated control that opens another screen, `screens-exact`, `navigations-exact`, and `controls-stated` (no button, link, field, select, checkbox, radio, toggle, tab or nav item the prompt does not state). `wireframe-drawn` reads the scene: every screen a named frame and every component its own group with its words, inside its parent and its screen. `wireframe-layout` fails overlapping components, text that crosses a border or another text, and anything outside its screen.
