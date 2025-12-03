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

        {convexUser && <OpenPositions convexUser={convexUser} />}
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
    return (
      <TableBody>
        <TableRow>
          <TableCell>No open positions</TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {openDbPositions.map((dbPosition) => (
        <DlmmOpenPositionRow key={dbPosition._id} dbPosition={dbPosition} />
      ))}
    </TableBody>
  );
}
