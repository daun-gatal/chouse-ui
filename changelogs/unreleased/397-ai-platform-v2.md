type: minor

### Added
- **Streaming chat runs** — chat replies show each step as it happens, keep going when the chat is closed or the page reloads (reopening the thread picks the reply up), and stop on the server with **Stop**; the final answer appears once the output guardrails have checked it
- **Files and skills in the chat** — attach up to 3 files per message (CSV, TSV, text, logs, Markdown, JSON, SQL, and images or PDFs for models set to accept them in AI models); type `/` to give the agent one of its skills for that message
- **Approved AI actions** — agents can kill a query, save or schedule a query, create a health promise or a dashboard, update a table's context, or propose a fix; in the chat each action pauses the reply for the user to approve, edit or reject, then runs as them through the usual checks and audit. Actions from runs nobody watches wait in **AI Governance › Approvals**. New `ai:act` permission
- **Memory** — agents with memory turned on remember users' lasting preferences (saved with Undo) and team knowledge about a connection (after admin review, new `ai_memories:manage` permission); **AI Governance › Memories** to manage, export or turn memory off, and team notes about a table show with its context
- **Auto-triage** — per trigger (Data Health and Observe incidents, fleet alerts, failed scheduled runs, Doctor findings), an agent investigates new events on its own within a cooldown and a daily token budget, writes the likely cause to the incident's notebook, notifies alerting channels and proposes fixes for approval; **AI Governance › Triage**, with an **AI investigated** badge
- **AI budgets** — token and cost caps per AI feature and per user, per day or month, that stop requests or switch to a cheaper model when used up (new `ai_budgets:manage` permission); AI activity shows prompt-cache savings
- **Agent runtime settings** — fallback model, model and tool retries, model and tool call caps, prompt caching (on by default for Anthropic and Bedrock), clearing old tool results, and subagents that inherit the conversation
- **Analysis sandbox** — a harness can give its agents `js_eval`, a QuickJS sandbox that calls their read-only tools as functions and computes over the rows without sending them to the model
- **Agent evals** — test cases with expected tools and a judged rubric, run against an agent's draft from its Evals tab; an eval threshold blocks saving a draft that scores too low. Save cases from the test console or from chat requests in AI activity
- **Skill tools** — a skill can list tools that stay hidden from an agent until it reads the skill

### Changed
- **DeepAgents 1.15 and LangChain 1.5** — the AI runtime is upgraded; agents keep a to-do list again where their harness allows `write_todos`
- **Test console** — write tools only say what they would do; nothing is changed or recorded
