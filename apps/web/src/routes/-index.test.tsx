import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, Suspense } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { getRouter } from "../router";
import { HomeWorkspace } from "./index";

const ARCHITECTURE_BUTTON_NAME = /Architecture/;

beforeAll(() => {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

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

  test("uses TanStack Router search params for diagram selection", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/?diagram=flowchart"],
    });
    const router = getRouter({ history });

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByText(
        "Show the prompt-to-diagram generation flow as maintained packages."
      )
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: ARCHITECTURE_BUTTON_NAME })
    );

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        diagram: "architecture",
      });
    });
    expect(
      screen.getByText(
        "Show the package-first v2 architecture with app, worker, data, and AI boundaries."
      )
    ).toBeTruthy();
  });
});
