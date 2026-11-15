# Guardrail Enforcement Status

This document tracks the technical implementation of the project guardrails.

## 1. Implementation Matrix

| Rule | Enforcement Method | Status | Verification |
| :--- | :--- | :--- | :--- |
| **No Execution** | AGENTS.md + Harness Approval | ⚠️ Partial | Depends on user denying Bash prompts |
| **No Git/GitHub** | AGENTS.md + Instruction Layer | ⚠️ Partial | Prompt-based. No dummy binary installed |
| **No DB Access** | AGENTS.md | ⚠️ Partial | Prompt-based |
| **No Deletion** | AGENTS.md | ⚠️ Partial | Prompt-based |
| **Project Boundary** | AGENTS.md | ⚠️ Partial | Prompt-based |
| **No Impl. w/o Appr.**| Workflow Process | ✅ Active | Enforced by agent behavior |

## 2. Technical Limitations
- **Tool-Level Hooks**: Claude Code relies on user-mediated permission prompts. There is no automatic "block-list" for specific commands like `git` within the current harness configuration without OS-level intervention.
- **IDE Plugins**: Cursor and Copilot enforcement is prompt-based. They do not have native filesystem "deny" hooks that can be configured via text files.

## 3. Audit Trail
All blocked operations must be reported to the user immediately.

## 4. Extension Path
To move from "Partial (Prompt-based)" to "Full (Hard-block)", the following is required:
- OS-level restricted user account for AI agents.
- Custom Git wrapper that returns error for all commands.
- Network firewall rules to block DB ports.
