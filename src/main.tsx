import { createRoot } from "react-dom/client";
import "./styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { PrivyProviderWrapper } from "./providers/PrivyProvider";
import { ConvexClientProvider } from "./providers/ConvexClientProvider";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import { Navbar } from "./components/layout/Navbar";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./utils/queryClient";
import DlmmTradePage from "./routes/trade/DlmmTradePage";
import ClmmTradePage from "./routes/trade/ClmmTradePage";
import { useLastVisitedPool } from "./providers/useLastVisitedPool";
import Lend from "./routes/Lend";
import { DEFAULT_DLMM_POOL } from "./components/layout/PairSelector";
import { zAddress } from "../convex/utils/solana";

const DEAFULT_POOL_ROUTE = `/dlmm/${DEFAULT_DLMM_POOL}`;
const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col bg-background px-7 xl:px-16 py-10 overflow-x-hidden">
      <Navbar />
      <main className="flex flex-1  justify-center ">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/trade" replace />,
});

const dlmmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dlmm",
  component: () => <Outlet />,
});

const dlmmPoolRoute = createRoute({
  getParentRoute: () => dlmmRoute,
  path: "$poolAddress",
  component: DlmmTradePage,
  loader: async ({ params }) => {
    const { poolAddress } = params;
    const parsed = zAddress.safeParse(poolAddress);

    if (!parsed.success) {
      const store = useLastVisitedPool.getState();
      const fallback = store.lastVisited ?? DEAFULT_POOL_ROUTE;

      throw redirect({
        to: fallback,
        replace: true,
      });
    }

    // Address is valid here
    const validAddress = parsed.data;

    useLastVisitedPool.getState().setLastVisited({ poolAddress: validAddress, protocol: "dlmm" });

    return { poolAddress: validAddress };
  },
});

const clmmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clmm",
  component: () => <Outlet />,
});

const clmmPoolRoute = createRoute({
  getParentRoute: () => clmmRoute,
  path: "$poolAddress",
  component: ClmmTradePage,
  loader: async ({ params }) => {
    const { poolAddress } = params;

    useLastVisitedPool.getState().setLastVisited({ poolAddress, protocol: "clmm" });

    return { poolAddress };
  },
});

const tradeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trade",
  component: () => {
    const lastPool = useLastVisitedPool.getState().lastVisited;
    return <Navigate to={lastPool ?? DEAFULT_POOL_ROUTE} replace />;
  },
});

const lendRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lend",
  component: Lend,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  tradeRoute,
  dlmmRoute.addChildren([dlmmPoolRoute]),
  clmmRoute.addChildren([clmmPoolRoute]),
  lendRoute,
]);
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
