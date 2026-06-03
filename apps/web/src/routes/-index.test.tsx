import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode, Suspense } from "react";
import { describe, expect, test } from "vitest";
import { HomeWorkspace } from "./index";

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>{ui}</Suspense>
    </QueryClientProvider>
  );
}

describe("home route workspace", () => {
  test("renders the generated architecture diagram from TanStack Query data", async () => {
    renderWithQuery(<HomeWorkspace selectedDiagramId="architecture" />);

    expect(await screen.findByText("Sketchi v2")).toBeTruthy();
    expect(screen.getByText("TanStack app")).toBeTruthy();
    expect(screen.getByText("4 nodes")).toBeTruthy();
    expect(screen.getByText("3 edges")).toBeTruthy();
  });
});
