import { GenerationWorkspace } from "@sketchi/diagram-studio-ui";
import "@sketchi/diagram-studio-ui/styles.css";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { diagramCatalogQueryOptions } from "../diagrams";

export interface HomeSearch {
  diagram?: string;
}

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(diagramCatalogQueryOptions),
  validateSearch: (search): HomeSearch =>
    typeof search.diagram === "string" ? { diagram: search.diagram } : {},
  component: Home,
});

export interface HomeWorkspaceProps {
  onSelectedDiagramChange?: ((id: string) => void) | undefined;
  selectedDiagramId?: string | undefined;
}

export function HomeWorkspace({
  onSelectedDiagramChange,
  selectedDiagramId,
}: HomeWorkspaceProps) {
  const { data: diagrams } = useSuspenseQuery(diagramCatalogQueryOptions);
  const selectedId = diagrams.some(
    (diagram) => diagram.id === selectedDiagramId
  )
    ? selectedDiagramId
    : diagrams[0]?.id;

  return (
    <GenerationWorkspace
      diagrams={diagrams}
      onSelectedDiagramChange={onSelectedDiagramChange}
      selectedDiagramId={selectedId}
      status="rendered"
    />
  );
}

function Home() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  return (
    <HomeWorkspace
      onSelectedDiagramChange={(diagram) => {
        navigate({
          search: { diagram },
        });
      }}
      selectedDiagramId={search.diagram}
    />
  );
}
