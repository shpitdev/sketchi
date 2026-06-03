import { createRouter } from "@tanstack/react-router";
import { createQueryClient } from "./router-context";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = createQueryClient();

  return createRouter({
    context: {
      queryClient,
    },
    defaultNotFoundComponent: DefaultNotFoundComponent,
    defaultPreload: "intent",
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
