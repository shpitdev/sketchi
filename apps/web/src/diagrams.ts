import { generatedDiagramCatalog } from "@sketchi/diagram-core";
import { queryOptions } from "@tanstack/react-query";

function loadDiagramCatalog() {
  return generatedDiagramCatalog;
}

export const diagramCatalogQueryOptions = queryOptions({
  queryFn: loadDiagramCatalog,
  queryKey: ["diagram-catalog"],
  staleTime: 60_000,
});
