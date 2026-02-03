import { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Spinner } from "./ui/Spinner";
import { ArrowUpRight, Check, X } from "lucide-react";
import { create } from "zustand";
import { ActivityType } from "../../convex/schema/activities";
import {
  ActionRes,
  ActionSuccessPayloads,
} from "../../convex/types/actionResults";

type TrackerStates = "loading" | "success" | "failed";

interface TrackerBase {
  id: string;
  loadingDescription?: string;
  errorMsg?: string;
  status: TrackerStates;
}

type TrackerMap = {
  [K in ActivityType]:
    | (TrackerBase & { type: K; status: "loading" | "failed" })
    | (TrackerBase & {
        type: K;
        status: "success";
        result: ActionSuccessPayloads[K];
      });
};

export type Tracker = TrackerMap[ActivityType];

/* ---------- Zustand State ---------- */
interface ActionTrackerState {
  trackers: Tracker[];
  addTracker: (tracker: Omit<Tracker, "id">) => string;
  updateTracker: <T extends ActivityType>(
    id: string,
    updates: Partial<Extract<Tracker, { type: T }>>,
  ) => void;
  removeTracker: (id: string) => void;
}
export const useActionTrackerStore = create<ActionTrackerState>()((set) => ({
  trackers: [],

  addTracker: <T extends Tracker>(tracker: Omit<T, "id">) => {
    const id = crypto.randomUUID();
    set((s) => ({
      trackers: [...s.trackers, { id, ...tracker } as Tracker],
    }));
    return id;
  },
  updateTracker: (id, updates) =>
    set((s) => ({
      trackers: s.trackers.map((t) =>
        t.id === id ? ({ ...t, ...updates } as Tracker) : t,
      ),
    })),
  removeTracker: (id) =>
    set((s) => ({
      trackers: s.trackers.filter((t) => t.id !== id),
    })),
}));

export async function startTrackingAction<T extends ActivityType>({
  type,
  loadingDescription,
  action,
  onSuccess,
  onFailed,
}: {
  type: T;
  loadingDescription?: string;
  action: Promise<ActionRes<T>>;
  onSuccess?: () => void;
  onFailed?: () => void;
}) {
  const { addTracker, updateTracker, removeTracker } =
    useActionTrackerStore.getState();

  const id = addTracker({
    type,
    status: "loading",
    loadingDescription,
  });

  try {
    const fn = () => action;
    const res = await fn();

    if (res.status === "success") {
      updateTracker(id, {
        status: "success",
        result: res.result,
      } as any);
      onSuccess?.();
    } else {
      updateTracker(id, { status: "failed", errorMsg: res.errorMsg });
      onFailed?.();
    }
  } catch (err: any) {
    updateTracker(id, { status: "failed", errorMsg: err.message });
    onFailed?.();
  } finally {
    // auto-remove after 5s if not loading
    setTimeout(() => removeTracker(id), 5000);
  }
}

export function ActionTracker() {
  const { trackers, removeTracker } = useActionTrackerStore();

  return (
    <div className="fixed bottom-10 left-7 flex flex-col gap-2 z-9999">
      <AnimatePresence>
        {trackers.map((t) => {
          if (t.type === "create_position") {
            return (
              <CreatePositionTracker
                key={t.id}
                tracker={t}
                onClose={() => removeTracker(t.id)}
              />
            );
          } else if (t.type === "close_position") {
            return (
              <ClosePositionTracker
                key={t.id}
                tracker={t}
                onClose={() => removeTracker(t.id)}
              />
            );
          } else if (t.type === "claim_fees") {
            return (
              <ClaimFeesTracker
                key={t.id}
                tracker={t}
                onClose={() => removeTracker(t.id)}
              />
            );
          }
          return null;
        })}
      </AnimatePresence>
    </div>
  );
}
function TrackerToast({
  children,
  status,
  onClose,
}: {
  children: ReactNode;
  status: TrackerStates;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="flex flex-row items-start bg-white/5 backdrop-blur-xl inner-white rounded-2xl z-40 drop-shadow-2xl gap-2 px-5 py-4 min-w-[318px] max-w-[340px]"
      initial={{ opacity: 0, scale: 0.9, y: 75 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 100 }}
      transition={{
        type: "spring",
        damping: 10,
        stiffness: 200,
        duration: 500,
      }}
    >
      {status === "success" ? (
        <div className="bg-green p-1 rounded-full items-center">
          <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
        </div>
      ) : status === "failed" ? (
        <div className="bg-red p-1 rounded-full items-center">
          <X className="w-2.5 h-2.5 text-black" strokeWidth={3} />
        </div>
      ) : (
        <Spinner className="text-textSecondary w-4 h-4" />
      )}
      <div className="flex flex-1 min-w-0 overflow-hidden">{children}</div>

      <X
        onClick={onClose}
        className="w-4 h-4 text-textSecondary hover:text-text hover-effect cursor-pointer active:scale-95 mt-0.5"
      />
    </motion.div>
  );
}

function CreatePositionTracker({
  tracker,
  onClose,
}: {
  tracker: Extract<Tracker, { type: "create_position" }>;
  onClose: () => void;
}) {
  const { status, loadingDescription, errorMsg } = tracker;

  if (status === "success") {
    const { createPositionTxId } = tracker.result;
    return (
      <TrackerToast status="success" onClose={onClose}>
        <div className="flex flex-col items-start justify-start gap-2 max-w-[340px] ">
          <div className="text-text text-sm leading-none">Position Created</div>
          <div
            className="flex flex-row items-center gap-0.5 group cursor-pointer active:scale-95"
            onClick={() =>
              window.open(
                `https://solscan.io/tx/${createPositionTxId}`,
                "_blank",
              )
            }
          >
            <ArrowUpRight className="w-3 h-3 text-primary" />
            <div className="text-primary text-xs group-hover:underline">
              View transaction
            </div>
          </div>
        </div>
      </TrackerToast>
    );
  }

  if (status === "failed") {
    return (
      <TrackerToast status="failed" onClose={onClose}>
        <div className="flex flex-col items-start justify-start gap-1 max-w-[340px]">
          <div className="text-text text-sm leading-none">
            Failed To Create Position
          </div>
          <div className="text-textSecondary text-xs wrap-break-word">
            {errorMsg}
          </div>
        </div>
      </TrackerToast>
    );
  }

  return (
    <TrackerToast status="loading" onClose={onClose}>
      <div className="flex flex-col items-start justify-start gap-1 max-w-[340px]">
        <div className="text-text text-sm leading-none">Creating Position</div>
        <div className="text-textSecondary text-xs">{loadingDescription}</div>
      </div>
    </TrackerToast>
  );
}

function ClosePositionTracker({
  tracker,
  onClose,
}: {
  tracker: Extract<Tracker, { type: "close_position" }>;
  onClose: () => void;
}) {
  const { status, loadingDescription, errorMsg } = tracker;

  if (status === "success") {
    const { closedPositionId } = tracker.result;
    return (
      <TrackerToast status="success" onClose={onClose}>
        <div className="flex flex-col items-start justify-start gap-2 max-w-[340px] ">
          <div className="text-text text-sm leading-none">Position Closed!</div>
          <div
            className="flex flex-row items-center gap-0.5 group cursor-pointer active:scale-95"
            onClick={() =>
              window.open(`https://solscan.io/tx/${closedPositionId}`, "_blank")
            }
          >
            <ArrowUpRight className="w-3 h-3 text-primary" />
            <div className="text-primary text-xs group-hover:underline">
              View transaction
            </div>
          </div>
        </div>
      </TrackerToast>
    );
  }

  if (status === "failed") {
    return (
      <TrackerToast status="failed" onClose={onClose}>
        <div className="flex flex-col items-start justify-start gap-1 max-w-[340px]">
          <div className="text-text text-sm leading-none">
            Failed To Close Position
          </div>
          <div className="text-textSecondary text-xs wrap-break-word">
            {errorMsg}
          </div>
        </div>
      </TrackerToast>
    );
  }

  return (
    <TrackerToast status="loading" onClose={onClose}>
      <div className="flex flex-col items-start justify-start gap-1 max-w-[340px]">
        <div className="text-text text-sm leading-none">Closing Position</div>
        <div className="text-textSecondary text-xs">{loadingDescription}</div>
      </div>
    </TrackerToast>
  );
}

function ClaimFeesTracker({
  tracker,
  onClose,
}: {
  tracker: Extract<Tracker, { type: "claim_fees" }>;
  onClose: () => void;
}) {
  const { status, loadingDescription, errorMsg } = tracker;

  if (status === "success") {
    const { claimFeeTxId } = tracker.result;
    return (
      <TrackerToast status="success" onClose={onClose}>
        <div className="flex flex-col items-start justify-start gap-2 max-w-[340px] ">
          <div className="text-text text-sm leading-none">Fees Claimed!</div>
          <div
            className="flex flex-row items-center gap-0.5 group cursor-pointer active:scale-95"
            onClick={() =>
              window.open(`https://solscan.io/tx/${claimFeeTxId}`, "_blank")
            }
          >
            <ArrowUpRight className="w-3 h-3 text-primary" />
            <div className="text-primary text-xs group-hover:underline">
              View transaction
            </div>
          </div>
        </div>
      </TrackerToast>
    );
  }

  if (status === "failed") {
    return (
      <TrackerToast status="failed" onClose={onClose}>
        <div className="flex flex-col items-start justify-start gap-1 max-w-[340px]">
          <div className="text-text text-sm leading-none">
            Failed To Claim Fees
          </div>
          <div className="text-textSecondary text-xs wrap-break-word">
            {errorMsg}
          </div>
        </div>
      </TrackerToast>
    );
  }

  return (
    <TrackerToast status="loading" onClose={onClose}>
      <div className="flex flex-col items-start justify-start gap-1 max-w-[340px]">
        <div className="text-text text-sm leading-none">Claiming Fees</div>
        <div className="text-textSecondary text-xs">{loadingDescription}</div>
      </div>
    </TrackerToast>
  );
}
