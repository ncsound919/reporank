# @reporank/cli

Code review accuracy benchmark + quality gate for AI-generated code.

## Install

```bash
npm install -g @reporank/cli
```

## `reporank verify` — Quality gate

Run a structured quality review on any file or directory. Exits non-zero
if the quality score is below the threshold — perfect for CI integration.

### Basic usage

```bash
# Single file, heuristic-only
reporank verify src/index.ts --no-llm

# Whole directory with LLM review
reporank verify src/

# CI gate — exit 1 if quality < 70
reporank verify src/ --threshold 70
```

### Modes

| Flag | Purpose |
|------|---------|
| `--diff` | Read git diff from stdin, only analyze changed files |
| `--pr <n>` | Fetch PR diff via `gh` CLI, analyze changed files |
| `--no-llm` | Heuristic-only (fast, no API cost) |
| `--detect-hallucinations` | Phantom import detection (LLM hallucination guard) |
| `--json` | Structured JSON output |
| `--gh-markdown` | GitHub-flavored markdown (for PR comments) |
| `--threshold <n>` | Minimum quality score 0-100 (default: 70) |
| `--mode <mode>` | LLM prompt mode: zero-shot, few-shot, react, strict |

### Output formats

- **text** (default): human-readable summary
- **json**: structured output for CI parsing
- **gh-markdown**: GitHub-flavored markdown for PR comments

### Examples

```bash
# CI: fail if quality score < 80 on PR diff
git diff origin/main | reporank verify . --diff --threshold 80

# Comment a PR with quality results
reporank verify . --pr 42 --gh-markdown > pr-comment.md

# Catch phantom imports in AI-generated code
reporank verify src/ --detect-hallucinations --json | jq '.hallucinations.hallucinations'
```

## GitHub Actions integration

Copy `.github/workflows/reporank-verify.yml` to your repo.  Configure
`VIBESERVE_URL` and `VIBESERVE_API_KEY` as repository secrets.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `VIBESERVE_URL` | `http://127.0.0.1:8000` | LLM endpoint |
| `VIBESERVE_API_KEY` | (empty) | Auth key for the endpoint |
| `REPORANK_NO_LLM_CACHE` | `0` | Set to `1` to force fresh LLM calls |
| `OLLAMA_MODEL` | (auto) | Override the model name in cache keys |
