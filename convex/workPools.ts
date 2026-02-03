"use node";
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

export const orderExecutionWorkPool = new Workpool(
  components.limitOrdersExecutionPool,
  {
    maxParallelism: 45,
  },
);
