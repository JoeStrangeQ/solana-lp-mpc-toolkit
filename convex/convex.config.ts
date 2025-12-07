// convex/convex.config.ts
import { defineApp } from "convex/server";
import cache from "@convex-dev/action-cache/convex.config";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(cache);
app.use(workpool, { name: "limitOrdersExecutionPool" });

export default app;
