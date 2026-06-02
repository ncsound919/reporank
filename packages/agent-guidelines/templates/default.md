# AGENTS.md (Default)

## Security
- **🔴 No secrets in code** — API keys, tokens, and credentials must be in environment variables.
- **🔴 No eval()** — eval() allows arbitrary code execution.
- **🟡 Sanitize user input** — All user-provided data must be validated with Zod or similar.

## Code Quality
- **🔴 Handle async errors** — Every async function must have try/catch or .catch().
- **🟡 Keep files under 300 lines** — Smaller files are easier for humans and AI to reason about.
- **🟡 Remove debug code** — console.log and debugger statements must be removed before committing.
- **🟡 Add type annotations** — Function parameters and return types should be annotated.

## Agent Behavior
- **🔴 Agent must not write code without review** — All AI-generated code requires human review before merging.
- **🟡 Agent explains, not solves** — When asked questions, guide toward understanding, not direct answers.
