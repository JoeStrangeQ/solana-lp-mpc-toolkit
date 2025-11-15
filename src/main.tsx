import { createRoot } from "react-dom/client";
import "./styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { PrivyProviderWrapper } from "./providers/PrivyProvider";
import { ConvexClientProvider } from "./providers/ConvexClientProvider";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import Home from "./routes/Home";
import { Navbar } from "./components/layout/Navbar";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./utils/queryClient";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col bg-background px-7 xl:px-20 py-12">
      <Navbar />
      <main className="hidden xl:flex flex-1  justify-center ">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

const routeTree = rootRoute.addChildren([indexRoute]);

const router = createRouter({
  routeTree,
  context: {},
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
});

createRoot(document.getElementById("root")!).render(
  <>
    <QueryClientProvider client={queryClient}>
      <PrivyProviderWrapper>
        <ConvexClientProvider>
          <RouterProvider router={router} />
          <ReactQueryDevtools initialIsOpen={false} />
        </ConvexClientProvider>
      </PrivyProviderWrapper>
    </QueryClientProvider>

    {/* <SpeedInsights /> */}
  </>
);
