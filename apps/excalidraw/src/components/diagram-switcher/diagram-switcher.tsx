export interface DiagramOption {
  edgeCount: number;
  id: string;
  nodeCount: number;
  title: string;
  type: string;
}

export interface DiagramSwitcherProps {
  activeId: string;
  diagrams: readonly DiagramOption[];
  onSelect: (id: string) => void;
}

export function DiagramSwitcher({
  activeId,
  diagrams,
  onSelect,
}: DiagramSwitcherProps) {
  return (
    <section className="diagram-switcher" aria-label="Sample diagrams">
      <p className="diagram-switcher__label">Sample diagrams</p>
      <div className="diagram-switcher__list" role="group">
        {diagrams.map((diagram) => {
          const active = diagram.id === activeId;

          return (
            <button
              aria-pressed={active}
              className="diagram-switcher__item"
              key={diagram.id}
              onClick={() => onSelect(diagram.id)}
              type="button"
            >
              <span className="diagram-switcher__title">{diagram.title}</span>
              <span className="diagram-switcher__meta">
                <span className="diagram-switcher__type">{diagram.type}</span>
                <span>
                  {diagram.nodeCount} nodes · {diagram.edgeCount} edges
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
