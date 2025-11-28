import { Search } from "lucide-react";
import Backdrop from "../ui/Backdrop";
import { useState } from "react";

export function Searchbar() {
  const [searchInput, setSearchInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  // const debouncedSearch = useDebounce(searchInput, 300)

  function reset() {
    setIsOpen(false);
    setSearchInput("");
  }
  return (
    <div className="relative z-20 w-full hidden xl:block">
      <Backdrop show={isOpen} onClick={reset} />

      <div className="mx-auto flex w-[420px] h-min px-4 py-3 items-center justify-between bg-white/1 inner-white rounded-full focus-within:bg-white/3 transition-colors z-20 relative">
        <div className="flex flex-row gap-2 items-center w-full">
          <Search className="w-4 h-4 rounded-sm text-textSecondary" />
          <input
            type="text"
            placeholder="Search pool"
            value={searchInput}
            // onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            //   setSearchInput(e.target.value)
            // }
            // onFocus={() => setIsOpen((prev) => (prev ? prev : true))}
            className="bg-transparent w-full text-sm text-text font-semibold focus:outline-none"
          />
        </div>
        <div className="flex px-2 py-1 items-center justify-center bg-white/10 rounded-md text-[10px] text-textSecondary">
          /
        </div>
      </div>

      {/* <AnimatePresence>
        {isOpen && (
          <SearchResults
            searchInput={debouncedSearch}
            setSearchInput={setSearchInput}
            onClose={reset}
          />
        )}
      </AnimatePresence> */}
    </div>
  );
}

// function SearchResults({
//   searchInput,
//   setSearchInput,
//   onClose,
// }: {
//   searchInput: string
//   setSearchInput: (input: string) => void
//   onClose: () => void
// }) {
//   const { data, fetchNextPage, isFetchingNextPage, isLoading, status } =
//     useMeteoraPoolsSearch({ searchTerm: searchInput })

//   return (
//     <motion.div
//       className="fixed px-2 py-5 min-w-[528px] z-20 mt-2 bg-white/5 border border-white/10 rounded-4xl backdrop-blur-xl ml-12"
//       style={{
//         left: 'calc(50% - 350px)',
//       }}
//       initial={{ opacity: 0, height: 0 }}
//       animate={{ opacity: 1, height: 420 }}
//       exit={{ opacity: 0, height: 0 }}
//       transition={{ duration: 0.4, ease: 'easeInOut' }}
//     >
//       <div className="flex flex-row ml-2 mr-2 items-center justify-center gap-1 mb-5">
//         {PAIR_PILLS.map(({ tokenX, tokenY }, index) => {
//           return (
//             <MnMSuspense key={index} fallback={<PairPillSkeleton count={1} />}>
//               <PairPill
//                 mintX={toAddress(tokenX)}
//                 mintY={toAddress(tokenY)}
//                 onClick={(pairName) => setSearchInput(pairName)}
//               />
//             </MnMSuspense>
//           )
//         })}
//       </div>

//       <div className="text-textSecondary text-sm mb-4  font-medium ml-2">
//         Search results
//       </div>

//       {status === 'error' ? (
//         <div className="flex flex-col items-center justify-center gap-2 left-1/2 mt-28 ">
//           <CircleX className="h-10 w-10 text-red" />
//           <div className="  text-red font-semibold text-sm text-center">
//             There was an error fetching pools...
//           </div>
//         </div>
//       ) : data?.pages[0].pairs.length === 0 ? (
//         <div className="text-text/70 font-semibold text-sm text-center left-1/2 mt-32">
//           No pools found
//         </div>
//       ) : (
//         <div className="flex flex-1 flex-col gap-2 px-2 overflow-y-auto max-h-[300px] pb-6 custom-scrollbar">
//           {isLoading
//             ? Array.from({ length: 7 }).map((_, index) => (
//                 <PoolRowSkeleton key={index} />
//               ))
//             : data?.pages.map((page, pageIndex) => (
//                 <div key={pageIndex} className="flex flex-col gap-2">
//                   {page.pairs.map((pool, index) => (
//                     <MnMSuspense fallback={<PoolRowSkeleton />} key={index}>
//                       <PoolRow pool={pool} onClose={onClose} />
//                     </MnMSuspense>
//                   ))}

//                   {isFetchingNextPage &&
//                     Array.from({ length: 7 }).map((_, index) => (
//                       <PoolRowSkeleton key={index} />
//                     ))}
//                 </div>
//               ))}

//           <div
//             onClick={() => fetchNextPage()}
//             className="flex px-3 py-2 w-min h-min rounded-full bg-white/10 text-text text-xs whitespace-nowrap self-center cursor-pointer hover:bg-white/20 transition-all duration-300 ease-in-out"
//           >
//             {isFetchingNextPage ? 'Loading more...' : 'Load more'}
//           </div>
//         </div>
//       )}
//     </motion.div>
//   )
// }

// function PoolRow({
//   pool,
//   onClose,
// }: {
//   pool: MeteoraPool
//   onClose: () => void
// }) {
//   const tokenX = useToken({ mint: pool.mint_x })
//   const tokenY = useToken({ mint: pool.mint_y })
//   const liquidityUsd = usePoolLiquidity(pool)
//   const navigate = useNavigate()
//   return (
//     <motion.button
//       className="flex flex-row py-2 px-2 items-center rounded-2xl hover:bg-white/10 transition-all duration-300 ease-in-out cursor-pointer"
//       initial={{ opacity: 0, x: -1, y: -5, scale: 0.98 }}
//       animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
//       transition={{ duration: 0.2, ease: 'easeInOut' }}
//       onClick={() => {
//         navigate({ to: `/trade/${pool.address}` })
//         onClose()
//       }}
//     >
//       <div className="flex items-center justify-center -space-x-2">
//         <TokenIcon icon={tokenX.icon} className="h-7 w-7" />
//         <TokenIcon icon={tokenY.icon} className="h-7 w-7" />
//       </div>

//       <div className="flex flex-col -space-x-0.5 ml-2">
//         <div className="text-text text-sm font-semibold text-left">
//           {pool.name}
//         </div>
//         <div className="text-textSecondary text-xs text-left">
//           {pool.bin_step} Bin-step
//         </div>
//       </div>
//       <div className="px-2 py-0.5 rounded-full border border-white/5 ml-3">
//         <div className="text-text text-xs">
//           {abbreviateAmount(pool.base_fee_percentage, { type: 'percentage' })}%
//         </div>
//       </div>

//       <div className="flex flex-col w-16 items-center justify-center  ml-auto ">
//         <div className="text-text text-sm">
//           ${abbreviateAmount(liquidityUsd, { type: 'usd' })}
//         </div>
//         <div className="text-textSecondary text-xs">TVL</div>
//       </div>

//       <div className="flex flex-col w-16 items-center justify-center  ml-9 ">
//         <div className="text-text text-sm">
//           ${abbreviateAmount(pool.trade_volume_24h, { type: 'usd' })}
//         </div>
//         <div className="text-textSecondary text-xs">24h Vol</div>
//       </div>

//       <div className="flex flex-col w-16 items-center justify-center  ml-7 mr-0 ">
//         <div className="text-text text-sm">
//           {abbreviateAmount(pool.fee_tvl_ratio.hour_24, { type: 'percentage' })}
//           %
//         </div>
//         <div className="text-textSecondary text-xs">Fee/TVL</div>
//       </div>
//     </motion.button>
//   )
// }

// function PoolRowSkeleton() {
//   return (
//     <motion.div className="flex flex-row py-2 px-2 items-center rounded-2xl ">
//       <Skeleton className="h-8 w-10 rounded-full" />

//       <div className="flex flex-col gap-1 ml-2">
//         <Skeleton className="w-14 h-3 rounded-full" />
//         <Skeleton className="w-14 h-3 rounded-full" />
//       </div>

//       <div className="flex flex-col w-16 items-center justify-center  gap-1 ml-auto ">
//         <Skeleton className="w-14 h-3 rounded-full" />
//         <Skeleton className="w-14 h-3 rounded-full" />
//       </div>

//       <div className="flex flex-col w-16 items-center justify-center  gap-1 ml-9 ">
//         <Skeleton className="w-14 h-3 rounded-full" />
//         <Skeleton className="w-14 h-3 rounded-full" />
//       </div>

//       <Skeleton className="w-14 h-5 rounded-full ml-7 mr-0 " />
//     </motion.div>
//   )
// }

// function PairPillSkeleton({ count }: { count: number }) {
//   return (
//     <>
//       {Array.from({ length: count }).map((_, index) => (
//         <motion.div
//           key={index}
//           className="flex px-3 py-2 items-center justify-center bg-backgroundSecondary/90 border border-white/5 rounded-full gap-1 hover:bg-white/10 transition-all duration-300 ease-in-out cursor-pointer"
//           initial={{ opacity: 0 }}
//           animate={{ opacity: 1 }}
//           transition={{ duration: 0.4, ease: 'easeInOut' }}
//         >
//           <Skeleton className="h-5 w-9 rounded-full" />
//           <Skeleton className="w-15 h-3 rounded-full" />
//         </motion.div>
//       ))}
//     </>
//   )
// }

// function PairPill({
//   mintX,
//   mintY,
//   onClick,
// }: {
//   mintX: Address
//   mintY: Address
//   onClick: (pairName: string) => void
// }) {
//   const tokenX = useToken({ mint: mintX })
//   const tokenY = useToken({ mint: mintY })

//   if (!tokenX || !tokenY || !tokenX.icon || !tokenY.icon) return null
//   return (
//     <motion.button
//       onClick={() => {
//         onClick(`${tokenX.symbol}-${tokenY.symbol}`)
//       }}
//       className="flex px-3 py-2 items-center justify-center bg-backgroundSecondary/90 border border-white/5 rounded-full gap-1 hover:bg-white/10 transition-all duration-300 ease-in-out cursor-pointer"
//       initial={{ opacity: 0 }}
//       animate={{ opacity: 1 }}
//       transition={{ duration: 0.4, ease: 'easeInOut' }}
//     >
//       <div className="flex items-center justify-center -space-x-1">
//         <TokenIcon icon={tokenX.icon} className="h-5 w-5" />
//         <TokenIcon icon={tokenY.icon} className="h-5 w-5" />
//       </div>

//       <div className="text-text font-medium text-sm ">
//         {tokenX.symbol}-{tokenY.symbol}
//       </div>
//     </motion.button>
//   )
// }

// export const PAIR_PILLS: { tokenX: string; tokenY: string }[] = [
//   {
//     tokenX: 'So11111111111111111111111111111111111111112',
//     tokenY: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
//   },
//   {
//     tokenX: 'So11111111111111111111111111111111111111112',
//     tokenY: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
//   },
//   {
//     tokenX: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
//     tokenY: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
//   },
//   {
//     tokenX: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
//     tokenY: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
//   },
// ]
