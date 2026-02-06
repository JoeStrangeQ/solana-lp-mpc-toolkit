# Feature Proposal: LP Agent v2 (Inspired by Trojan)

Joe, you mentioned looking at Trojan for inspiration. While Trojan is a swap/trading bot, we can apply its principles of advanced control and automation to our LP management bot.

Here's a proposal for a v2 feature set that would make our bot significantly more powerful.

---

### 1. Advanced Automated Rebalancing

Instead of just manual rebalancing, we can offer automated strategies that users can configure.

**User commands:**
-   `/rebalance auto <pool> --if-out-of-range-for 1h`
-   `/rebalance schedule --all --every monday-9am`
-   `/rebalance off <pool>`

**Implementation:** This would require our background worker to not just check position status, but also evaluate user-defined rules and trigger the rebalancing flow.

---

### 2. LP Range Orders ("Limit Orders" for LPs)

Allow users to enter positions only when specific price conditions are met.

**User commands:**
-   `/lp 1 SOL into SOL-USDC --when-price-between 130-135`
-   `/lp into JUP-SOL --when-price-below 0.80`

**Implementation:** This is a major feature. It would need a price monitoring service and a secure way to queue and execute these conditional orders.

---

### 3. DCA (Dollar-Cost Averaging) for Positions

Let users build up their positions over time automatically.

**User commands:**
-   `/dca 0.1 SOL into MET-USDC --every day --for 7-days`
-   `/dca cancel <pool>`

**Implementation:** This would also use the background worker, running on a schedule to execute the LP transactions.

---

### 4. Portfolio Analytics & Reporting

Provide users with insights into their LP performance beyond the current snapshot.

**New commands:**
-   `/portfolio`: Shows a chart of total LP value over the last 30 days.
-   `/fees`: Displays a detailed breakdown of fees earned per pool, with historical data.
-   `/summary`: Get a daily/weekly email or Telegram summary of your LP performance.

**Implementation:** We'd need to start storing historical snapshots of position values and fees in our database.

---

### 5. Multi-Wallet Support

Allow power users to manage LP positions across multiple wallets.

**New commands:**
-   `/wallets add <name>` (generates a new MPC wallet)
-   `/wallets import <name> <private_key>` (securely stored)
-   `/wallets switch <name>`
-   `/wallets list`

**Implementation:** Our user model would need to be updated to support a list of wallets instead of a single one. All commands (`/lp`, `/positions`, etc.) would operate on the currently active wallet.

---

This roadmap would move us from a simple execution tool to a true "agent" that manages LP strategies over time. This seems to align with the power and control that bots like Trojan offer.

What do you think of this direction?
