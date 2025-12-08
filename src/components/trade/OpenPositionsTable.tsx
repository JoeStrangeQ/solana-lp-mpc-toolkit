import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { useConvexUser } from "~/providers/UserStates";

import { TableRow, TableHead, TableHeader, TableBody, TableCell, Table } from "../ui/Table";
import { DlmmOpenPositionRow } from "./DlmmOpenPosition";

export function OpenPositionsTable() {
  const { convexUser } = useConvexUser();
  return (
    <div className="w-full overflow-x-auto rounded-2xl bg-backgroundSecondary p-4 custom-scrollbar">
      <Table className="table-auto">
        <TableHeader>
          <TableRow>
            <TableHead className="text-textSecondary/60">Pool</TableHead>
            <TableHead className="text-textSecondary/60">Size</TableHead>
            <TableHead className="text-textSecondary/60">Range</TableHead>
            <TableHead className="text-textSecondary/60">Price/Entry</TableHead>
            <TableHead className="text-textSecondary/60">Liquidation</TableHead>
            <TableHead className="text-textSecondary/60">SL/TP</TableHead>
            <TableHead className="text-textSecondary/60">PnL</TableHead>
            <TableHead></TableHead> {/* buttons column */}
          </TableRow>
        </TableHeader>

        {convexUser ? <OpenPositions convexUser={convexUser} /> : <NoPositionPlaceholder />}
      </Table>
    </div>
  );
}

function OpenPositions({ convexUser }: { convexUser: Doc<"users"> }) {
  const openDbPositions = useQuery(api.tables.positions.get.getUserOpenPositions, { userId: convexUser._id });

  if (!openDbPositions) {
    return (
      <TableBody>
        <TableRow>
          <TableCell>Loading...</TableCell>
        </TableRow>
      </TableBody>
    );
  }

  if (openDbPositions.length === 0) {
    return <NoPositionPlaceholder />;
  }
  return (
    <TableBody>
      {openDbPositions.map((dbPosition) => (
        <DlmmOpenPositionRow key={dbPosition._id} dbPosition={dbPosition} />
      ))}
    </TableBody>
  );
}

function NoPositionPlaceholder() {
  return (
    <TableBody>
      <TableRow>
        <TableCell colSpan={8} className="h-[200px]">
          <div className="flex flex-col w-full h-full items-center justify-center gap-4">
            {/* Illustration */}
            <div className="relative h-20 w-20">
              <div className="absolute inset-0 rounded-full bg-white/5 blur-xl" />
              <div className="relative flex h-full w-full items-center justify-center rounded-3xl border border-white/5 bg-backgroundSecondary">
                <svg width="64" height="48" viewBox="0 0 64 48" className="text-[#B6D162]/90">
                  <line x1="8" y1="38" x2="56" y2="38" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
                  <rect x="14" y="24" width="6" height="14" rx="2" fill="currentColor" opacity="0.35" />
                  <rect x="24" y="18" width="6" height="20" rx="2" fill="currentColor" opacity="0.55" />
                  <rect x="34" y="14" width="6" height="24" rx="2" fill="currentColor" opacity="0.9" />
                  <rect x="44" y="20" width="6" height="18" rx="2" fill="currentColor" opacity="0.6" />
                  <circle cx="50" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.7" />
                  <line x1="46" y1="12" x2="54" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            {/* Text */}

            <div className="flex flex-col text-center">
              <p className="text-sm font-medium text-white/80">No open positions yet</p>
              <p className="text-xs text-white/45 max-w-xs">
                When you create your first position,
                <br />
                it will appear here.
              </p>
            </div>
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  );
}
