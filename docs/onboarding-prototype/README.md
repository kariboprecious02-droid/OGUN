# Admin Merchant Onboarding — Prototype Handoff

This directory contains everything Claude Code needs to translate the finalised
prototype of the admin merchant onboarding flow into the real Next.js admin app.

## Quick start (for the next agent picking this up)

1. Open Claude Code from the **`OGUN/`** repo root.
2. Paste the body of `00-PROMPT.md` (between the `---` lines) as your first message.
3. Follow the phases in order.

## Files

| File                          | Purpose                                                                    |
|-------------------------------|----------------------------------------------------------------------------|
| `00-PROMPT.md`                | The verbatim prompt for Claude Code. Single source for scope + conventions.|
| `01-prototype.html`           | Compiled, runnable single-file React prototype (dark theme).               |
| `02-prototype-source.jsx`     | Pre-compiled JSX source. Visual + behavioural reference.                   |
| `03-validation-report.md`     | **Load-bearing.** Confirms every route, schema, and path against repo HEAD `1124162b...`. Trust over the prototype on conflicts. |
| `04-drift-analysis.md`        | Per-step UI vs. backend drift (state names, fields, ordering).             |
| `05-merge-checklist.md`       | 8-phase merge checklist with target file paths.                            |

## Repo state this pack is calibrated to

| Item   | Value |
|--------|-------|
| Branch | `claude/payment-infrastructure-kenya-jzQmF` |
| Commit | `1124162b1f0ea0c48bd649cb34085476d158b0f5` |
| Subject | "Expand merchant creation form to cover full PRD schema" |

If HEAD has moved, re-run §9 of the validation report before continuing.

## Why this lives in the repo (and not in a wiki)

The validation report cites file paths and line numbers from the same commit it lives next to. Keeping them in-tree means every PR comparing prototype-to-implementation can reference exact commits without wiki drift.
