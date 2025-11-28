import { ArrowDownToLine, Check, Copy, LogOut, Minus } from "lucide-react";
import SolanaFmIcon from "~/assets/solana-fm.png";
import { useState } from "react";
import { useConvexUser } from "~/providers/UserStates";
import { usePrivy, useSolanaWallets } from "@privy-io/react-auth";
// import { useBalances, useTotalUsdBalance } from '~/states/balances'
// import {
//   abbreviateAmount,
//   formatUsdValue,
//   tokenAmountFormatter,
// } from '~/utils/numberFormats'
import { useFundWallet } from "@privy-io/react-auth/solana";
import { Skeleton } from "../ui/Skeleton";
import { convex } from "~/providers/ConvexClientProvider";
import { cn } from "~/utils/cn";
import { MnMSuspense } from "../MnMSuspense";
import { Row } from "../ui/Row";
import { RefreshTokenBalancesIcon } from "../RefreshBalanceIcon";
import { Doc } from "../../../convex/_generated/dataModel";
import { SolScanIcon } from "../icons/SolScanIcon";
import { Ticker } from "../Ticker";
import { TokenIcon } from "../TokenIcon";
import { abbreviateAmount, formatUsdValue, tokenAmountFormatter } from "~/utils/numberFormats";
import { abbreviateAddress } from "~/utils/solana";
import { MnMIcon } from "../icons/MnMIcon";
import { useBalances, useTotalUsdBalance } from "~/states/balances";
import { toAddress } from "../../../convex/utils/solana";
import { Button } from "../ui/Button";

export function WalletSidebar({ user, onClose }: { user: Doc<"users">; onClose: () => void }) {
  const [tab, setTab] = useState<"Portfolio" | "Activities">("Portfolio");
  const tabOptions = ["Portfolio", "Activities"] as const;

  return (
    <div className="flex flex-col flex-1 items-start ">
      <Header user={user} onClose={onClose} />
      <MnMSuspense fallback={<TotalBalanceSkeleton />}>
        <TotalBalance userAddress={user.address} onCloseSideBar={onClose} />
      </MnMSuspense>

      <div className="flex flex-row items-center  justify-between w-full mt-5 mb-3.5 ">
        <Row justify="start" className="gap-3 ">
          {tabOptions.map((t) => (
            <div
              className={`hover-effect select-none cursor-pointer active:scale-95 ${t === tab ? "text-text" : "text-textSecondary/40 hover:text-text/80"}`}
              onClick={() => setTab(tab)}
              key={t}
            >
              {t}
            </div>
          ))}
        </Row>
        <RefreshTokenBalancesIcon userAddress={user.address} size="sm" />
      </div>

      {tab === "Portfolio" ? (
        <MnMSuspense fallback={<TokenListSkeleton />}>
          <TokenList userAddress={user.address} />
        </MnMSuspense>
      ) : (
        <></>
        // <MnMSuspense fallback={<ActivitiesSkeleton />}>
        //   <Activities convexUser={user} />
        // </MnMSuspense>
      )}
    </div>
  );
}
function Header({ user, onClose }: { user: Doc<"users">; onClose: () => void }) {
  const { signout } = useConvexUser();
  const { logout } = usePrivy();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(user.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <Row justify="start" className="mb-8">
      <div className="flex p-3 rounded-full bg-backgroundSecondary">
        <MnMIcon className="w-6 h-6 text-textSecondary" />
      </div>

      <div className="flex flex-col ml-2 gap-1">
        <div className="text-text text-sm">{abbreviateAddress(user.address)}</div>
        <Row justify="start" className="gap-2">
          <div className="w-3.5 h-3.5  hover-effect cursor-pointer hover:scale-105" onClick={handleCopy}>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-textSecondary hover:text-text" />
            )}
          </div>

          <div
            className="cursor-pointer hover-effect hover:scale-115"
            onClick={() => window.open(`https://solscan.io/account/${user.address}`, "_blank")}
          >
            <SolScanIcon className="w-3.5 h-3.5" />
          </div>

          <div
            className="cursor-pointer hover-effect hover:scale-115"
            onClick={() => window.open(`https://solana.fm/address/${user.address}`, "_blank")}
          >
            <img src={SolanaFmIcon} className="w-3.5 h-3.5" />
          </div>
        </Row>
      </div>

      <div
        className="ml-auto mr-0 bg-red/10 p-2 rounded-xl hover-effect hover:bg-red/15 cursor-pointer active:scale-95 "
        onClick={async () => {
          await logout();
          convex.clearAuth();
          onClose();
          signout();
        }}
      >
        <LogOut className="w-4 h-4 text-red" />
      </div>
    </Row>
  );
}

function TotalBalance({ userAddress }: { userAddress: string; onCloseSideBar: () => void }) {
  // const { resetWithdrawModalStates } = useWithdrawModalStates();
  // const { convexUser } = useConvexUser();
  const { fundWallet } = useFundWallet();
  const { exportWallet } = useSolanaWallets();

  const totalUsdBalance = useTotalUsdBalance({ address: userAddress });
  const formattedUsdBalance = formatUsdValue(totalUsdBalance);

  const tickerSize =
    formattedUsdBalance.toString().length >= 15
      ? "text-2xl"
      : formattedUsdBalance.toString().length >= 11
        ? "text-3xl"
        : "text-4xl";

  // const [withdrawModalVis, setWithdrawModalVis] = useState(false);
  return (
    <>
      <Row>
        <div className="flex flex-col w-full">
          <Button variant="neutral" onClick={exportWallet}>
            Export
          </Button>
          <div className="text-textSecondary text-nowrap mb-0.5 ">Total balance</div>

          <Row>
            <Ticker value={formattedUsdBalance} className={tickerSize} />

            <Row className="gap-2 w-min">
              <button
                className="flex p-2.5 bg-white/10 inner-white hover-effect hover:bg-white/15 active:scale-95 rounded-full cursor-pointer self-end "
                // onClick={() => setWithdrawModalVis(true)}
              >
                <Minus className="text-white w-3.5 h-3.5" />
              </button>
              <button
                className="flex p-2.5 bg-primary/10 inner-primary hover-effect hover:bg-primary/15 active:scale-95 rounded-full cursor-pointer self-end"
                onClick={async () => await fundWallet(userAddress)}
              >
                <ArrowDownToLine className="text-primary w-3.5 h-3.5" />
              </button>
            </Row>
          </Row>
        </div>
      </Row>
      {/* {convexUser && (
        <Modal
          title={"Withdraw"}
          main={
            <WithdrawModalContent
              convexUser={convexUser}
              onClose={() => {
                setWithdrawModalVis(false);
                onCloseSideBar();
              }}
            />
          }
          onClose={() => {
            setWithdrawModalVis(false);
            resetWithdrawModalStates();
          }}
          show={withdrawModalVis}
        />
      )} */}
    </>
  );
}

function TotalBalanceSkeleton() {
  return (
    <Row>
      <div className="flex flex-col w-full ">
        <div className="text-textSecondary text-nowrap mb-0.5">Total balance</div>

        <Row>
          <Skeleton className="h-9 w-40 " />

          <Row className="gap-2 w-min">
            <button
              className="flex p-2.5 bg-white/10 inner-white hover-effect hover:bg-white/15 active:scale-95 rounded-full cursor-pointer self-end opacity-30 "
              disabled
            >
              <Minus className="text-white w-3.5 h-3.5" />
            </button>
            <button
              className="flex p-2.5 bg-primary/10 inner-primary hover-effect hover:bg-primary/15 active:scale-95 rounded-full cursor-pointer self-end opacity-30"
              disabled
            >
              <ArrowDownToLine className="text-primary w-3.5 h-3.5" />
            </button>
          </Row>
        </Row>
      </div>
    </Row>
  );
}

function TokenList({ userAddress }: { userAddress: string }) {
  const { data } = useBalances({ address: toAddress(userAddress) });

  return (
    <div className="flex flex-col gap-3.5 w-full overflow-y-scroll custom-scrollbar">
      {data.map((token) => {
        const tokenAmount =
          token.symbol === "SOL"
            ? `${tokenAmountFormatter().format(token.balance)} SOL`
            : `${abbreviateAmount(token.balance, { type: "usd" })} ${token.symbol}`;
        const priceChange = token.priceChange ?? 0;
        return (
          <Row key={token.mint} justify="start">
            <TokenIcon logoURI={token.logoURI} className="h-8 w-8" />
            <div className="flex flex-col ml-2.5">
              <div className="text-text text-sm">{token.name}</div>
              <div className="text-textSecondary text-xs text-left">{tokenAmount}</div>
            </div>
            <div
              className={cn(
                ` px-1.5 py-0.5 rounded-2xl flex justify-center items-center text-center text-[10px] ml-3.5`,
                priceChange > 0 ? "text-green bg-green/10" : "text-red bg-red/10"
              )}
            >
              {priceChange > 0 ? "+" : "-"}
              {abbreviateAmount(priceChange, {
                type: "percentage",
                decimals: 2,
              })}
              %
            </div>

            <div className="text-text text-sm text-right ml-auto mr-0">{formatUsdValue(token.usdBalance)}</div>
          </Row>
        );
      })}
    </div>
  );
}

function TokenListSkeleton() {
  return (
    <div className="flex flex-col gap-3.5 mt-3 w-full">
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

// function Activities({ convexUser }: { convexUser: Doc<"users"> }) {
//   const {
//     results: activities,
//     status,
//     loadMore,
//   } = usePaginatedQuery(
//     api.tables.activities.get.getUserActivitiesPaginated,
//     { userId: convexUser._id },
//     { initialNumItems: 30 }
//   );

//   console.log("act", activities);
//   console.log("status", status);

//   const isEmptyFirstLoad = status === "LoadingFirstPage" && activities.length === 0;

//   if (isEmptyFirstLoad) {
//     return <ActivitiesSkeleton />;
//   }

//   return (
//     <div className="flex flex-col gap-3.5 mt-3.5 w-full overflow-y-scroll custom-scrollbar">
//       {activities.map((activity) => (
//         <Activity key={activity._id} activity={activity} />
//       ))}

//       {status === "LoadingMore" && <ActivitiesSkeleton />}

//       {status === "CanLoadMore" || status === "LoadingMore" ? (
//         <button
//           onClick={() => loadMore(30)}
//           disabled={status === "LoadingMore"}
//           className="flex px-3 py-2 rounded-full bg-white/10 text-text text-xs self-center mt-4 mb-6"
//         >
//           {status === "LoadingMore" ? "Loading…" : "Load More"}
//         </button>
//       ) : null}
//     </div>
//   );
// }
// export function ActivitiesSkeleton() {
//   return (
//     <div className="flex flex-col gap-3.5 mt-3 w-full">
//       {Array.from({ length: 7 }).map((_, i) => (
//         <Skeleton key={i} className="h-10 w-full rounded-lg" />
//       ))}
//     </div>
//   );
// }
