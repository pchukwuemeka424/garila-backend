---
description: Run a literature review on a topic using paper search and primary-source synthesis.
args: <topic>
section: Research Workflows
topLevelCli: true
---
## Tool Discipline (Read First)

Tool names are literal. Use only tools visible in the current tool set.

- Search with `web_search`; do not call `search_web`, `google_search`, `google:search`, `search_google`, or `WebSearch`.
- Fetch URLs with `fetch_content`; do not call bare `fetch`, `WebFetch`, `read_url_content`, or pass an array as `url`. Use `urls` for multiple URLs when the tool supports it.
- Use the `alpha` CLI through `bash`; do not invent an `alpha_search` tool.
- To ask the user a question, write plain chat text and wait for the next user message. Do not call `ask_user_question`, `ask_user`, `ask_followup_question`, or `user_choice`.
- Do not use `Task` as an agent dispatcher. Use only the visible `subagent` tool when it exists.
- If a tool returns `Tool not found` or `Invalid URL`, do not retry the same invalid call. Map to a canonical visible tool and valid arguments, or record the capability as blocked.

Investigate the following topic as a literature review: $@

Derive a short slug from the topic (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

## Workflow

1. **Plan** — Outline the scope: key questions, source types to search (papers, web, repos), time period, expected sections, and a small task ledger plus verification log. Write the plan to `outputs/.plans/<slug>.md`. Briefly summarize the plan to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested plan review.
   - When updating the plan ledger later, keep edits small and valid. If an `edit` tool call fails with a JSON parse error or the replacement would require embedding a large markdown block, rewrite the full corrected plan file with the file-writing tool instead, then continue to final artifact/provenance verification.
2. **Gather** — Use the `researcher` subagent when the sweep is wide enough to benefit from delegated paper triage before synthesis. For narrow topics, search directly. Researcher outputs go to `<slug>-research-*.md`. Do not silently skip assigned questions; mark them `done`, `blocked`, or `superseded`.
3. **Synthesize** — Separate consensus, disagreements, and open questions. When useful, propose concrete next experiments or follow-up reading. Generate charts with `pi-charts` for quantitative comparisons across papers and Mermaid diagrams for taxonomies or method pipelines. Before finishing the draft, sweep every strong claim against the verification log and downgrade anything that is inferred or single-source critical.
4. **Cite** — Spawn the `verifier` agent to add inline citations and verify every source URL in the draft.
5. **Verify** — Spawn the `reviewer` agent to check the cited draft for unsupported claims, logical gaps, zombie sections, and single-source critical findings. Fix FATAL issues before delivering. Note MAJOR issues in Open Questions. If FATAL issues were found, run one more verification pass after the fixes.
6. **Deliver** — Save the final literature review to `outputs/<slug>.md`. Write a provenance record alongside it as `outputs/<slug>.provenance.md` listing: date, sources consulted vs. accepted vs. rejected, verification status, and intermediate research files used. Before you stop, verify on disk that both files exist; do not stop at an intermediate cited draft alone.
