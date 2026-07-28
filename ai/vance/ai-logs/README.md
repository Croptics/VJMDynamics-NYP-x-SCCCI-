# AI Logs (C1) — how to add them

This folder is where my Claude Code session logs (`.jsonl`) go for the **C1 — AI
Workflow** deliverable. They're not committed yet — see the security note below.

## Where the raw logs are

Claude Code saves every session automatically as `.jsonl` here:

```
C:\Users\<you>\.claude\projects\C--Users-cropt-Documents-Projects-VJMDynamics-NYP-x-SCCCI-\
```

One `.jsonl` per session, covering design → coding → testing across the project.

## ⚠️ Redact before committing

The raw logs contain the **live shared Neon database connection string, including
the password** (it appears in tool output whenever the backend booted). This repo
is pushed to GitHub, so committing the logs as-is would leak the whole team's DB
credentials.

Before copying a log in here, replace the password in every connection string:

```
postgresql://neondb_owner:<password>@ep-...neon.tech   →   postgresql://neondb_owner:REDACTED@ep-...neon.tech
```

Then double-check nothing sensitive remains, e.g. search the copied files for
`neondb_owner:` and confirm every hit reads `:REDACTED@`.

## Steps

1. Copy the `.jsonl` files from the `.claude\projects\...` folder above into here.
2. Redact the connection-string password in each (as above).
3. Verify they're clean, then `git add ai/vance/ai-logs/*.jsonl` and commit.

> Consider rotating the Neon password at some point, since it has been present in
> local logs.
