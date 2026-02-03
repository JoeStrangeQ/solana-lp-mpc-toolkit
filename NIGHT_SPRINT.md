- Feb 3 01:15 - Joe went to bed, started night sprint for polish
- **01:15 - 02:45: BLOCKER - Meteora SDK Investigation**
  - **Goal:** Implement real TX building for "zero failure rates".
  - **Problem:** The `@meteora-ag/dlmm` SDK has a critical dependency issue with `@coral-xyz/anchor`'s `BN` export in an ESM environment.
  - **Attempts to Fix (all failed):**
    1.  `patch-package` to fix imports in `dist` files.
    2.  `patch-package` to fix imports in `src` files.
    3.  Custom `pre-test` script to forcefully patch `node_modules`.
    4.  `npm overrides` to force compatible dependency versions.
    5.  Compiling with `tsc` instead of `tsx`, which revealed broken type definitions in the SDK.
  - **Conclusion:** The SDK is fundamentally incompatible with our modern TypeScript/ESM stack. It is currently **unusable** for building transactions. This is a major blocker for achieving "zero failure rates" for Meteora.
- **Next Steps:**
  1.  Reverted `txBuilder.ts` to the safe, placeholder-based version.
  2.  Will investigate Orca SDK (`@orca-so/whirlpools-sdk`) as an alternative for real TX building. It is generally more stable.
  3.  Continuing with other polishing tasks from the night sprint plan.
