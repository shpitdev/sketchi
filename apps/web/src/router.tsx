import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { createQueryClient } from "./router-context";
import { routeTree } from "./routeTree.gen";

export interface GetRouterOptions {
  history?: RouterHistory;
}

export function getRouter(options: GetRouterOptions = {}) {
  const queryClient = createQueryClient();

  return createRouter({
    context: {
      queryClient,
    },
    defaultNotFoundComponent: DefaultNotFoundComponent,
    defaultPreload: "intent",
    ...(options.history ? { history: options.history } : {}),
    routeTree,
    scrollRestoration: true,
  });
}

function DefaultNotFoundComponent() {
  return (
    <main
      style={{
        display: "grid",
        minHeight: "100vh",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <section>
        <p>Not found</p>
      </section>
    </main>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
