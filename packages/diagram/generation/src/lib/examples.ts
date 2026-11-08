/**
 * One worked example per family whose requests the CLI lost graded samples on: a tuning
 * scenario and the answer Haiku 5.5 gave that passed grading on all three samples, curated
 * only where it disagreed with a rule (the class answer drew an unstated aggregation; the
 * quadrant answer carried styles its request did not need). The flowchart answer is Haiku's,
 * rewritten as the flowchart document. A typed request of one of these families gets its example
 * in place of the family's JSON shape.
 */
import type { DiagramTypeValue } from "@sketchi/diagram-core";

export interface CuratedExample {
	readonly request: string;
	readonly answer: string;
}

export const CURATED_EXAMPLES: Partial<Readonly<Record<DiagramTypeValue, CuratedExample>>> = {
	// subscription-renewal-dunning
	flowchart: {
		request:
			"Create a subscription renewal dunning flowchart. A renewal is due and the system charges payment. If payment succeeds, renew the subscription. If payment fails, send a reminder and decide whether payment was updated. Updated payment retries the charge. If not updated, decide whether the grace period has expired. Expired grace pauses the subscription; otherwise send another reminder.",
		answer:
			'{"title":"Subscription renewal dunning","diagram":{"type":"flowchart","id":"subscription-renewal-dunning","nodes":{"due":"Renewal due","charge":"Charge payment","paid":"Payment succeeded?","renew":"Renew subscription","remind":"Send payment reminder","updated":"Payment updated?","grace":"Grace period expired?","pause":"Pause subscription","again":"Send another reminder"},"edges":[["due","charge"],["charge","paid"],["paid","renew","yes"],["paid","remind","no"],["remind","updated"],["updated","charge","yes"],["updated","grace","no"],["grace","pause","yes"],["grace","again","no"],["again","updated"]]}}',
	},
	// media-player-state-machine
	"state-machine": {
		request:
			"State machine for a media player. It starts Stopped. Play moves it into Active, a composite state that starts in Playing. Inside Active, pause moves Playing to Paused and resume moves Paused back to Playing; seek keeps it in Playing with action jump to position. Stop, from anywhere in Active, returns it to Stopped. Eject from Stopped ends the machine.",
		answer:
			'{"title":"Media player state machine","diagram":{"id":"media-player","type":"state-machine","initial":"stopped","states":[{"id":"stopped","label":"Stopped"},{"id":"active","label":"Active","initial":"playing"},{"id":"playing","label":"Playing","parent":"active"},{"id":"paused","label":"Paused","parent":"active"},{"id":"ejected","label":"Ejected","kind":"final"}],"transitions":[{"id":"t-play","source":"stopped","target":"active","event":"play"},{"id":"t-pause","source":"playing","target":"paused","event":"pause"},{"id":"t-resume","source":"paused","target":"playing","event":"resume"},{"id":"t-seek","source":"playing","target":"playing","event":"seek","action":"jump to position"},{"id":"t-stop","source":"active","target":"stopped","event":"stop"},{"id":"t-eject","source":"stopped","target":"ejected","event":"eject"}]}}',
	},
	// course-enrollment-er-v2
	er: {
		request:
			"can you make an ER diagram of our enrollment tables\n\ncreate table students (id int primary key, name text not null, email text not null unique);\ncreate table courses (id int primary key, code text not null unique, title text not null);\ncreate table enrollments (student_id int not null references students(id), course_id int not null references courses(id), enrolled_on date not null, grade text, primary key (student_id, course_id));",
		answer:
			'{"title":"Enrollment tables ER diagram","diagram":{"id":"enrollment-er","type":"er","entities":[{"id":"students","name":"students","fields":["id int PK","name text","email text UK"]},{"id":"courses","name":"courses","fields":["id int PK","code text UK","title text"]},{"id":"enrollments","name":"enrollments","fields":["student_id int PK FK","course_id int PK FK","enrolled_on date","grade text?"]}],"relationships":[{"id":"student-enrollments","from":"enrollments.student_id","to":"students.id","fromCardinality":"zero-or-many","toCardinality":"one"},{"id":"course-enrollments","from":"enrollments.course_id","to":"courses.id","fromCardinality":"zero-or-many","toCardinality":"one"}]}}',
	},
	// shape-hierarchy-class-v2
	class: {
		request:
			"class diagram of our shape lib\n\ninterface Drawable {\n  draw(ctx: Canvas): void;\n}\n\nabstract class Shape implements Drawable {\n  protected x: number;\n  protected y: number;\n  abstract area(): number;\n  moveTo(x: number, y: number): void { ... }\n}\n\nclass Circle extends Shape {\n  private radius: number;\n  area(): number { ... }\n}\n\nclass Rectangle extends Shape {\n  private width: number;\n  private height: number;\n  area(): number { ... }\n}\n\nclass Square extends Rectangle {\n  static of(side: number): Square { ... }\n}\n\nclass Canvas {\n  static MAX_SHAPES: number = 500;\n  shapes: Shape[] = [];\n  add(shape: Shape): void { ... }\n}",
		answer:
			'{"title":"Shape library class diagram","diagram":{"id":"shape-lib","type":"class","classes":[{"id":"Drawable","name":"Drawable","kind":"interface","attributes":[],"methods":["+ draw(ctx: Canvas): void"]},{"id":"Shape","name":"Shape","kind":"abstract","attributes":["# x: number","# y: number"],"methods":["+ area(): number {abstract}","+ moveTo(x: number, y: number): void"]},{"id":"Circle","name":"Circle","attributes":["- radius: number"],"methods":["+ area(): number"]},{"id":"Rectangle","name":"Rectangle","attributes":["- width: number","- height: number"],"methods":["+ area(): number"]},{"id":"Square","name":"Square","attributes":[],"methods":["+ of(side: number): Square {static}"]},{"id":"Canvas","name":"Canvas","attributes":["+ MAX_SHAPES: number = 500 {static}","+ shapes: Shape[]"],"methods":["+ add(shape: Shape): void"]}],"relationships":[{"id":"shape-drawable","kind":"realization","from":"Shape","to":"Drawable"},{"id":"circle-shape","kind":"inheritance","from":"Circle","to":"Shape"},{"id":"rect-shape","kind":"inheritance","from":"Rectangle","to":"Shape"},{"id":"square-rect","kind":"inheritance","from":"Square","to":"Rectangle"},{"id":"canvas-shape","kind":"association","from":"Canvas","to":"Shape","fromMultiplicity":"1","toMultiplicity":"*","toRole":"shapes"}]}}',
	},
	// mobile-login-wireframe
	wireframe: {
		request:
			'Draw a mobile wireframe of our app\'s login screen. At the top, the heading "Welcome back" and the text "Sign in to continue". Below them, an Email input with the placeholder "you@example.com", a Password input and a "Remember me" checkbox. Then a primary "Sign in" button and a "Forgot password?" link. At the bottom, the text "New here?" and a "Create account" link.',
		answer:
			'{"title":"Login screen wireframe","diagram":{"id":"login-screen","type":"wireframe","screens":[{"id":"login","name":"Login","device":"mobile","children":[{"type":"heading","text":"Welcome back","level":1},{"type":"text","text":"Sign in to continue"},{"type":"input","label":"Email","placeholder":"you@example.com"},{"type":"input","label":"Password"},{"type":"checkbox","label":"Remember me"},{"type":"button","text":"Sign in","variant":"primary"},{"type":"link","text":"Forgot password?"},{"type":"footer","children":[{"type":"text","text":"New here?"},{"type":"link","text":"Create account"}]}]}]}}',
	},
	// competitor-positioning-quadrant-v2
	quadrant: {
		request:
			"price vs ease of use positioning quadrant for PM tools, highlight Our product\nquadrants: best value (cheap, easy), premium and simple (pricey, easy), budget and complex (cheap, hard), overpriced (pricey, hard)\n\ntool, price, ease of use (both 0-100)\nTrello, 25, 85\nAsana, 60, 75\nMonday.com, 65, 80\nJira, 55, 30\nWrike, 70, 45\nClickUp, 35, 55\nSmartsheet, 75, 40\nBasecamp, 45, 70\nOur product, 40, 82",
		answer:
			'{"title":"PM tools: price vs ease of use","diagram":{"id":"pm-tools-price-ease","type":"quadrant","xAxis":{"title":"Price","low":"Cheap","high":"Pricey"},"yAxis":{"title":"Ease of use","low":"Hard","high":"Easy"},"quadrants":{"topLeft":"Best value","topRight":"Premium and simple","bottomLeft":"Budget and complex","bottomRight":"Overpriced"},"points":[{"label":"Trello","x":0.25,"y":0.85},{"label":"Asana","x":0.6,"y":0.75},{"label":"Monday.com","x":0.65,"y":0.8},{"label":"Jira","x":0.55,"y":0.3},{"label":"Wrike","x":0.7,"y":0.45},{"label":"ClickUp","x":0.35,"y":0.55},{"label":"Smartsheet","x":0.75,"y":0.4},{"label":"Basecamp","x":0.45,"y":0.7},{"label":"Our product","x":0.4,"y":0.82,"group":"ours"}]}}',
	},
};
