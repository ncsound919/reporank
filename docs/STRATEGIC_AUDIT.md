# RepoRank Strategic Audit vs. Innovation Criteria
**Date:** June 2, 2026 | **Status:** Pre-acquisition readiness review

---

## Executive Summary

RepoRank has built a **strong foundation** in 3 of 5 strategic areas. It owns a genuine niche (scope + repo health truth), but lacks the **delivery dashboards**, **multi-repo depth**, and **enterprise infrastructure** needed to be competitive at acquisition or IPO. This audit maps the codebase against the 5 criteria sets and prioritizes the gaps that matter most for market positioning.

**VERDICT:** MVP-ready for the "narrow niche" (scope-aware repo health for AI builders) but needs 2–3 months of focused work to be acquisition-grade.

---

## 1. Strategic Positioning — What RepoRank *Is*

### ✅ **Strong: Repo-level scope & health truth**
- **Built:** ProjectBrief (deliverables, exclusions, constraints, assumptions, acceptance criteria)
- **Implemented:** ScopeMatcher detects:
  - ✅ Unplanned features (feature-creep)
  - ✅ Missing planned items (missing-planned)
  - ✅ Dependency creep
  - ✅ Technical complexity drift
- **Evidence:** [apps/api/src/services/scopeMatcher.ts](apps/api/src/services/scopeMatcher.ts)

**Why it matters:** Competitors (Sonar, CodeScene, DeepCode) don't do scope matching—they only catch bugs/style. RepoRank's differentiation is **"You said X, the code proves Y."** This is owned.

---

### ✅ **Strong: Multi-signal health model**
Combines 8 dimensions into one score:
- **Security** — secrets, vulns, dependency risks (via Claw, Trivy)
- **Quality** — code smells, tests, duplication, hygiene
- **Vibe** — AI contamination, modernness, hygiene (VibeCodingIndex)
- **Architecture** — coupling, complexity, modularity
- **Deployment** — Docker, CI, health checks, logging
- **Documentation** — README, setup guides, API docs
- **License** — copyleft, conflicts, attribution
- **Market** — trend alignment, percentile rank

**Evidence:** [packages/shared-types/src/health-report.ts](packages/shared-types/src/health-report.ts#L1)

**Gap:** No organization-level **trendlines** or **historical hotspot analysis** yet. Competitors publish these; RepoRank computes them but doesn't surface them in dashboards.

---

### 🟡 **Partial: Evidence & confidence labeling**
**Built:**
- ✅ `EvidenceLevel` enum: `"verified" | "inferred" | "missing-proof" | "human-needed"`
- ✅ Each finding tagged with source (e.g., "Static code analysis", "Pattern matching", "AI grading")
- ✅ `whyWeThinkThis` explanation fields

**Evidence:** [apps/api/src/services/evidenceLabeler.ts](apps/api/src/services/evidenceLabeler.ts#L1)

**Gap:** Labels are generated but **not surfaced prominently in API/UI.** Enterprise buyers want to see at a glance which findings are "I trust this" vs. "please review." Frontend dashboard doesn't have a filtering/sorting layer by confidence.

---

### 🟡 **Partial: AI-builder realism layer**
**Built:**
- ✅ buildSource tagging: `"github" | "bolt" | "lovable" | "manual-upload" | "other"`
- ✅ Portability checks (basic): detects non-standard hosting (S3, proprietary DBs)
- ✅ Intent parsing: extracts promised features from prompts/briefs
- ✅ IntentGaps: compares promised vs. implemented

**Missing:**
- ❌ No **Bolt-specific** rules (e.g., "Bolt projects must not hardcode API endpoints")
- ❌ No **Lovable-specific** checks (e.g., "Lovable exports should use standard React patterns")
- ❌ No **workflow specialization** per builder (different quality gates for V0 vs. GitHub projects)
- ❌ Placeholder endpoints return "NOT IMPLEMENTED" instead of real logic

**Evidence:**  
- Portability checks: [apps/api/src/services/builderContext.ts](apps/api/src/services/builderContext.ts)  
- Placeholders: [apps/api/src/routes/intent.ts#L41](apps/api/src/routes/intent.ts#L41)

---

## 2. Technical Capability Criteria

### ✅ **Strong: Multi-signal health model**
See Section 1. Combines 8 independent signals, each evidence-backed.

---

### ✅ **Strong: Scope-aware reasoning**
- ✅ Structured scope input (ProjectBrief with 7 fields: deliverables, exclusions, constraints, assumptions, acceptance criteria, deadline, timebox)
- ✅ Automatic scope drift detection (unplanned features, missing planned items)
- ✅ Intent parsing (extracts from prompts/PRDs)
- ✅ Change tracking (ScopeChangeRequest workflow)

**Evidence:** [apps/api/src/routes/projects.ts](apps/api/src/routes/projects.ts#L1)

---

### 🟡 **Partial: Architectural and multi-repo understanding**
**Built:**
- ✅ Single-repo architecture analysis (coupling, complexity, complexity rating)
- ✅ Circular import detection
- ✅ API contract discovery

**Missing:**
- ❌ **Cross-repo dependency understanding** (monorepo hotspots, inter-service contracts)
- ❌ **Long-term hotspot tracking** (churn + complexity + defects clustering)
- ❌ **Architectural drift detection** over time (contract breakages, new deps)
- ❌ Multi-branch context (only current scan snapshot, no historical context)

**Impact:** Single-repo mode is fine for individual builders. But enterprise customers want to see "which service in our 50-repo monorepo is the risk?" RepoRank doesn't scan org-wide yet.

---

### 🟡 **Partial: Deep repo context (beyond PR/file)**
**Built:**
- ✅ Persistent scan history per repo (via Prisma)
- ✅ File tree, source files, git metadata preserved
- ✅ Hotspot detection (complex files)

**Missing:**
- ❌ Historical trend analysis (vibe over 10 scans, commit patterns over months)
- ❌ Git blame/history correlation (who introduced the debt, when)
- ❌ Contributor patterns (bus factor, knowledge silos)
- ❌ Burndown vs. debt accumulation (is team paying down tech debt or accumulating?)

---

### ✅ **Strong: Trust score (composite metric)**
Combines:
- Code health (40%)
- Vibe inverted (20%) — lower AI contamination is better
- Software2.0 compatibility (15%) — can LLMs work on this?
- Security posture (15%)
- AGENTS.md compliance (10% bonus)

**Evidence:** [packages/grading-engine/src/analyzers/trust.ts](packages/grading-engine/src/analyzers/trust.ts#L1)

**Why it matters:** Single headline number (0–100) that's "hard to fake" and meaningful across product. Good for marketing and dashboards.

---

### ❌ **Missing: Published performance benchmarks**
**Gap:** No independent benchmark suite showing:
- Detection rates on seeded-bug suites (CompareCode claims 42–48%)
- False positive rates per finding type
- Supported languages coverage
- Performance metrics (scan time, accuracy vs. false positives)

**Impact:** Competitors (Greptile, Snyk) publish these transparently. RepoRank's ability to "prove" it catches bugs and avoids false alarms is currently just marketing claims.

---

## 3. Experience & Workflow Criteria

### ✅ **Strong: Senior reviewer + multi-pass design**
**Built:**
- ✅ Milestones with gates (architecture → behavior → tests → scope flow)
- ✅ Change control workflow (scope changes require approval)
- ✅ Evidence surfacing (all findings labeled)
- ✅ Approval model (brief approvals with version tracking)

**Evidence:** [apps/api/src/routes/milestones.ts](apps/api/src/routes/milestones.ts)

---

### 🟡 **Partial: Build truth dashboards**
**Built:**
- ✅ API endpoints for project/scan/drift data
- ✅ Scan history retention
- ✅ Brief approval tracking
- ❌ **Frontend dashboards are minimal**
  - ScanDetailPage exists but very basic
  - No organization-level views
  - No trendline charting
  - No milestone burndown
  - No drift trend over time

**Evidence:** [apps/web/src/pages/ScanDetailPage.tsx](apps/web/src/pages/ScanDetailPage.tsx#L1)

**Impact:** Enterprise requirement is **"health and risk dashboards per repo and org."** Without UI, the data is invisible.

---

### 🟡 **Partial: GitHub and CI integration**
**Built:**
- ✅ PR comment routes (scores, findings)
- ✅ Badge generation (shields.io compatible)
- ✅ Badges route (`/badges/:owner/:repo`)

**Missing:**
- ❌ Webhook handling (GitHub push/PR events → auto-scan)
- ❌ Status check integration (blocks PRs on low scores)
- ❌ Lightweight annotations in diffs (only full comments supported)
- ❌ CI/CD pipeline integration (GitHub Actions, GitLab CI, etc.)

---

### 🟡 **Partial: Developer experience**
**Built:**
- ✅ Clear error messages
- ✅ Evidence explanations (why findings matter)
- ✅ Quick wins guidance
- ✅ Roadmap suggestions

**Missing:**
- ❌ IDE plugins (VSCode, JetBrains)
- ❌ CLI output clarity (basic CLI exists but minimal UX)
- ❌ Drill-down UI (no "click to see affected lines" in web)
- ❌ Compare feature UI (API exists but no dashboard)

---

### ❌ **Missing: Transparent performance publishing**
No public benchmarks, detection rates, or independent verification.

---

## 4. Scope & Delivery Criteria

### ✅ **Strong: Formal scope model with gates**
- ✅ ProjectBrief (7 structured fields)
- ✅ Milestones with acceptance criteria snapshots
- ✅ Quality gates per milestone (deployment-ready, test-coverage, etc.)
- ✅ Approval workflow
- ✅ Change tracking (ScopeChangeRequest)

**Evidence:** [apps/api/src/routes/projects.ts](apps/api/src/routes/projects.ts)

---

### 🟡 **Partial: Measurable delivery impact**
**Built:**
- ✅ Scan history per repo (can compute "security improved 10 points since last milestone")
- ✅ Grade tracking (A+ → B means regression)
- ✅ Quick wins list (actionable improvements)

**Missing:**
- ❌ Delivery metrics dashboard (cycle time, bug escape rate, test debt accumulation)
- ❌ Correlation to business outcomes ("how many bugs escaped to prod?")
- ❌ Organizational trends (teams trending up/down in health)

---

### 🟡 **Partial: AI-builder realism checks**
See Section 1 — basic support but needs specialization per builder.

---

## 5. Enterprise & Acquisition Readiness

### ❌ **Missing: Enterprise evaluation checklist**
Criteria from Pensero's enterprise guide:

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Context depth | 🟡 Partial | Single-repo snapshot only; no historical hotspots |
| Review accuracy | 🟡 Partial | Multi-signal but no published benchmarks |
| Multi-repo understanding | ❌ Missing | Single-repo only |
| Integration (GitHub, GitLab, Azure) | 🟡 Partial | GitHub PR/badge; no GitLab/Azure |
| Agentic automation | ✅ Yes | Worker orchestration, multi-engine (vibe, deep, novel, fix-pack) |
| Testing intelligence | 🟡 Partial | Detects test presence; no coverage correlation |
| Enterprise readiness | ❌ Missing | No VPC/on-prem, no zero-retention mode |
| Scalability | ❌ Unknown | No load testing, no org-wide scans |
| Developer experience | 🟡 Partial | API solid; UI minimal; no IDE plugins |

---

### ❌ **Missing: Data moat**
**Gap:** No mechanism to accumulate labeled dataset of:
- Repos by health/maturity level
- Scope drift patterns (what kinds of deviations are common?)
- Builder source vs. code quality (is Bolt different from GitHub?)
- Scope accuracy vs. actual delivery (how often do teams miss scope?)

**Why:** Competitors (LinearB, CodeScene) have years of data. RepoRank can't retrain models or publish insights without it.

---

### ❌ **Missing: Workflow entrenchment**
- No GitHub Actions marketplace app
- No GitLab CI integration
- No Azure DevOps integration
- Placeholders for Bolt/Lovable but not real

---

### ❌ **Missing: Zero-retention + compliance**
No VPC/on-prem deployment, no zero-retention mode, no HIPAA/SOC2 readiness.

---

## Gap Prioritization

### 🔴 **CRITICAL (Ship before go-to-market)**
1. **Frontend dashboards for org/repo health trends**
   - Milestone burndown
   - Health trendline (last 10 scans)
   - Risk hotspots (which repos drifting most?)
   - Scope compliance % (planned vs. implemented)

2. **GitHub integration (webhooks + status checks)**
   - Auto-trigger scans on push
   - Block PRs below score threshold
   - Lightweight diff annotations

3. **Published benchmarks**
   - Run on seeded-bug suites
   - Publish detection/false positive rates
   - Compare vs. Sonar, DeepCode (be transparent)

### 🟡 **IMPORTANT (Next 6–12 weeks)**
4. **AI-builder specialization**
   - Bolt-specific rules (hosting, exports, patterns)
   - Lovable-specific checks (React patterns, portability)
   - V0-specific validation

5. **Enterprise readiness**
   - Org-wide dashboard (50+ repos)
   - VPC/on-prem deployment path
   - SSO support
   - Audit logging

6. **Historical hotspot tracking**
   - Churn + complexity clustering
   - Contributor patterns (bus factor)
   - Debt accumulation trends

7. **Multi-repo understanding**
   - Monorepo inter-service contracts
   - Circular dependency detection across repos
   - Cross-service hotspots

### 🟢 **NICE TO HAVE (Post-MVP)**
8. IDE plugins (VSCode, JetBrains)
9. GitLab CI, Azure DevOps integration
10. Data moat (labeled dataset, trend insights)

---

## Acquisition Readiness Score

| Area | Score | Why |
|------|-------|-----|
| **Product-market fit** | 7/10 | Clear niche (scope + vibe), but needs proof via dashboards |
| **Technical depth** | 8/10 | Strong grading engine, good evidence labeling |
| **Market positioning** | 6/10 | Not yet differentiated vs. DeepCode + Sonar combo |
| **Enterprise readiness** | 3/10 | Missing VPC, org dashboards, benchmarks |
| **Data moat** | 2/10 | No labeled dataset; can't retrain |
| **Team velocity** | 8/10 | Tests passing, builds clean, good code quality |

**Overall: 5.7/10 — Pre-acquisition potential but needs 8–12 weeks of focus on dashboards + GitHub integration + enterprise readiness.**

---

## Recommended 12-Week Roadmap

### Weeks 1–3: Frontend dashboards
- [ ] Org dashboard with repo list + health scores
- [ ] Repo health trendline (last 10 scans)
- [ ] Scope compliance tracker (% deliverables implemented)
- [ ] Drift trendline (on-scope → at-risk → drifting)
- [ ] Risk hotspots (top 10 repos by drift/security)

### Weeks 4–6: GitHub integration
- [ ] Webhook handling (push → auto-scan)
- [ ] PR status checks (fail if score < threshold)
- [ ] Lightweight diff comments (1-liner summary + link to full report)
- [ ] Org-level GitHub App

### Weeks 7–8: Benchmarks
- [ ] Seed bug suite (50–100 repos with known issues)
- [ ] Run RepoRank against suite
- [ ] Measure detection rate, false positive rate per finding type
- [ ] Publish results (website, white paper)

### Weeks 9–10: Builder specialization
- [ ] Bolt validation rules
- [ ] Lovable validation rules
- [ ] V0 validation rules
- [ ] Update quality gates per buildSource

### Weeks 11–12: Enterprise hardening
- [ ] VPC deployment documentation
- [ ] Org-level role-based access control
- [ ] Audit logging
- [ ] On-prem database support (optional but mention in docs)

---

## Why This Matters

**For funding:** "We own scope-aware repo health, which competitors don't. We have proof (dashboards + benchmarks). We're enterprise-ready (VPC + SSO + org dashboards)."

**For acquisition:** "Three ways to acquire RepoRank's value:  
1. **GitHub/GitLab**: Use for quality gates in CI/CD (entrenched workflow).  
2. **Sonar/Snyk**: Integrate our scope + vibe signals into their bug/sec focus.  
3. **No-code/AI builders**: Embed our realism check into Bolt, Lovable, V0 exports."

---

## Conclusion

RepoRank has **built the right engine** (scope matching + multi-signal grading + evidence labeling). It's missing the **right surface** (dashboards, integration, benchmarks) to be competitive.

**Current state:** Strong MVP for "scope-aware repo health for devs building with AI."

**Acquisition state:** 8–12 weeks of focused work to be credible to acquirers or VCs.

**Recommendation:** 
1. Ship dashboards first (fastest ROI, proves value to early users).
2. GitHub integration second (entrenchment).
3. Benchmarks third (defensibility).
4. Builder specialization parallel (market positioning).
