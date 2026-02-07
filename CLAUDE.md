# Claude Code Instructions

## Autonomy
- Act autonomously. Do not ask for confirmation before editing files, running commands, deploying, or committing.
- Fix issues end-to-end without stopping to ask. If something breaks, debug and fix it.
- Only ask when there's a genuine ambiguity about requirements or direction.

## Project
- Protected modules (do not modify): src/dex/, src/jito/, src/privacy/, src/mpc/, src/swap/
- Deploy command: `railway up --service lp-agent-api --detach`
- Wait ~2 min after deploy, verify with GET /stats (check startedAt)
- Always run `npx tsc --noEmit` before committing

## Testing
- After any bot changes, test by simulating webhook requests to /bot/webhook
- Check Railway logs: `railway logs --service lp-agent-api`
- Verify no errors in logs after testing
