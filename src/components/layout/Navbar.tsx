import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ConnectButton } from "./ConnectButton";
import { MnMIcon } from "../icons/MnMIcon";
import { cn } from "~/utils/cn";
import { DEFAULT_DLMM_POOL, PairSelector, PairSelectorSkeleton } from "./PairSelector";
import { toAddress } from "../../../convex/utils/solana";
import { MnMSuspense } from "../MnMSuspense";
import { Protocol } from "~/providers/useLastVisitedPool";

type Routes = "Trade" | "Lend" | "Docs";
const routes: {
  route: Routes;
  redirect: string;
}[] = [
  {
    route: "Trade",
    redirect: "/trade",
  },
  {
    route: "Lend",
    redirect: "/lend",
  },
  { route: "Docs", redirect: "https://app.gitbook.com/o/LzCjQh0w4YjhqMfm9UE3/s/NHzKLkCz9k8MfmFpBS32/" },
];
export function Navbar() {
  const navigate = useNavigate();

  const currentRoute = useCurrentRoute();
  const poolInfo = useCurrentPoolAddress();

  const onNavClick = (route: Routes, redirect: string) => {
    // External links: open in new tab
    if (route === "Docs") {
      window.open(redirect, "_blank");
      return;
    }

    navigate({ to: redirect });
  };
  return (
    <div className="relative flex flex-row h-min w-full items-center justify-between">
      <div className="flex flex-row items-center gap-7">
        <button onClick={() => navigate({ to: "/" })} className="flex flex-row items-center cursor-pointer z-10">
          <MnMIcon className="h-9 w-9" />
        </button>
        <div className="flex flex-row items-center gap-2">
          {routes.map(({ route, redirect }) => {
            return (
              <div
                className={cn(
                  "flex px-3.5 py-1.5 rounded-full text-text text-base cursor-pointer active:scale-95 select-none hover-effect",
                  route === currentRoute
                    ? "bg-text/10 inner-white backdrop-blur-lg hover:bg-text/12"
                    : "hover:bg-text/5"
                )}
                onClick={() => onNavClick(route, redirect)}
              >
                {route}
              </div>
            );
          })}
        </div>
      </div>

      {currentRoute === "Trade" && (
        <MnMSuspense fallback={<PairSelectorSkeleton />}>
          <PairSelector
            currentPoolAddress={toAddress(poolInfo?.poolAddress ?? DEFAULT_DLMM_POOL)}
            protocol={poolInfo?.protocol ?? "dlmm"}
          />
        </MnMSuspense>
      )}

      <ConnectButton />
    </div>
  );
}

function useCurrentRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (/^\/lend/.test(pathname)) return "Lend";
  if (/^(\/dlmm|\/clmm|\/damm|\/trade)/.test(pathname)) return "Trade";

  return "Trade";
}

function useCurrentPoolAddress() {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  // Matches: /dlmm/<address>
  const match = pathname.match(/^\/(dlmm|clmm|damm)\/([^/]+)/);

  if (!match) return null;

  const protocol = match[1] as Protocol;
  const poolAddress = match[2];

  return { protocol, poolAddress };
}
