/**
 * jsdom has no IntersectionObserver. This one records what each page
 * observes, and a test reports the scroll sentinel entering the viewport.
 */
export class TestIntersectionObserver {
	static readonly live = new Set<TestIntersectionObserver>();
	readonly elements = new Set<Element>();

	constructor(private readonly callback: IntersectionObserverCallback) {}

	observe(element: Element) {
		this.elements.add(element);
		TestIntersectionObserver.live.add(this);
	}

	unobserve(element: Element) {
		this.elements.delete(element);
	}

	disconnect() {
		this.elements.clear();
		TestIntersectionObserver.live.delete(this);
	}

	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}

	/** Report every observed element as near the viewport, as a scroll would. */
	static scrollNearEnd() {
		for (const observer of [...TestIntersectionObserver.live]) {
			const entries = [...observer.elements].map(
				(target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry,
			);
			observer.callback(entries, observer as unknown as IntersectionObserver);
		}
	}
}
