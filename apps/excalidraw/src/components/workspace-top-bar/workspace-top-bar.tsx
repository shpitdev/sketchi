import type { ReactNode } from "react";

export type WorkspaceStatus = "empty" | "error" | "loading" | "ready";

export interface WorkspaceTopBarProps {
  actions?: ReactNode;
  diagramType?: string | undefined;
  status?: WorkspaceStatus;
  title: string;
}

const statusMeta: Record<WorkspaceStatus, { dot: string; label: string }> = {
  empty: { dot: "sk-pill__dot--blueprint", label: "Empty" },
  error: { dot: "sk-pill__dot--danger", label: "Error" },
  loading: { dot: "sk-pill__dot--accent", label: "Generating" },
  ready: { dot: "sk-pill__dot--ok", label: "Ready" },
};

export function WorkspaceTopBar({
  actions,
  diagramType,
  status = "ready",
  title,
}: WorkspaceTopBarProps) {
  const meta = statusMeta[status];

  return (
    <header className="workspace-top-bar">
      <div className="workspace-top-bar__brand">
        <img
          alt=""
          className="workspace-top-bar__mark"
          height="30"
          src="/icon.svg"
          width="30"
        />
        <span className="workspace-top-bar__heading">
          <span className="workspace-top-bar__eyebrow">Sketchi workspace</span>
          <span className="workspace-top-bar__title">{title}</span>
        </span>
        {diagramType ? (
          <span className="workspace-top-bar__type">{diagramType}</span>
        ) : null}
      </div>

      <div className="workspace-top-bar__meta">
        <span className="sk-pill" aria-label="No-auth preview">
          <span className="sk-pill__dot sk-pill__dot--blueprint" />
          No sign-in · not saved
        </span>
        <span className="sk-pill" role="status">
          <span className={`sk-pill__dot ${meta.dot}`} />
          {meta.label}
        </span>
      </div>
      {actions ? (
        <div className="workspace-top-bar__actions">{actions}</div>
      ) : null}
    </header>
  );
}
