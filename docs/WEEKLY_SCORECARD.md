# RepoRank Innovation Criteria Scorecard

**Purpose:** Weekly progress tracking against the 5 strategic criteria. Use this to keep work aligned and flag blockers early.

---

## 1. Strategic Positioning: Repo-Level Scope & Health Truth

| Criterion | Target | Current | EOW1 | EOW2 | EOW3 | EOW4 | Status |
|-----------|--------|---------|------|------|------|------|--------|
| Scope model (deliverables, exclusions, constraints, acceptance criteria) | ✅ | ✅ | — | — | — | — | DONE |
| Drift detection (feature-creep, missing-planned, dependency-creep) | ✅ | ✅ | — | — | — | — | DONE |
| Multi-signal health (8 dimensions) | ✅ | ✅ | — | — | — | — | DONE |
| Evidence labeling (verified/inferred/missing/human-needed) | ✅ | 🟡 | 🟡 | 🟡 | ✅ | — | IN PROGRESS |
| Builder metadata (Bolt, Lovable, V0) | ✅ | 🟡 | 🟡 | 🟡 | ✅ | — | IN PROGRESS |
| **Positioning clarity** (pitch deck, landing page mention niche) | ✅ | 🟡 | 🟡 | 🟡 | ✅ | — | IN PROGRESS |

---

## 2. Technical Capability: Multi-Signal Model + Architecture Understanding

| Criterion | Target | Current | Progress | Risk |
|-----------|--------|---------|----------|------|
| Security (secrets, vulns, SAST) | ✅ | ✅ | DONE | None |
| Quality (smells, tests, duplication) | ✅ | ✅ | DONE | None |
| Vibe (AI contamination index) | ✅ | ✅ | DONE | None |
| Architecture (coupling, complexity) | ✅ | ✅ | DONE | None |
| Deployment (Docker, CI, health checks) | ✅ | ✅ | DONE | None |
| Documentation (README, setup, API docs) | ✅ | ✅ | DONE | None |
| License (copyleft, conflicts) | ✅ | ✅ | DONE | None |
| Market (trend alignment, percentile) | ✅ | ✅ | DONE | None |
| Trust score (composite 0-100) | ✅ | ✅ | DONE | None |
| **Historical hotspot tracking** | ✅ | ❌ | NOT STARTED | ⚠️ Nice-to-have, deprioritize |
| **Multi-repo understanding** | ✅ | ❌ | NOT STARTED | ⚠️ Post-MVP (weeks 13+) |
| **Published benchmarks** | ✅ | ❌ | Weeks 7-8 | Medium (required for credibility) |

---

## 3. Experience & Workflow: Dashboards + Integration + DX

| Criterion | Target | Current | EOW3 | EOW6 | EOW8 | Status |
|-----------|--------|---------|------|------|------|--------|
| **Org dashboard** (repos, health, trends) | ✅ | ❌ | 🟡 | ✅ | — | CRITICAL PATH |
| **Health trendline** (10-scan history, dimension breakdown) | ✅ | ❌ | 🟡 | ✅ | — | CRITICAL PATH |
| **Scope compliance tracker** (% deliverables implemented, drift) | ✅ | ❌ | 🟡 | ✅ | — | CRITICAL PATH |
| **Risk hotspots** (top repos by risk) | ✅ | ❌ | 🟡 | ✅ | — | CRITICAL PATH |
| **GitHub webhooks** (auto-trigger scans) | ✅ | ❌ | — | 🟡 | ✅ | CRITICAL PATH |
| **PR status checks** (blocks low-score PRs) | ✅ | ❌ | — | 🟡 | ✅ | CRITICAL PATH |
| **Lightweight PR comments** (1-liner + link) | ✅ | 🟡 | — | 🟡 | ✅ | CRITICAL PATH |
| **Comparison UI** (side-by-side scan delta) | ✅ | 🟡 | — | ✅ | — | High |
| Evidence filtering in UI | ✅ | ❌ | — | ✅ | — | Medium |
| IDE plugins (VSCode) | ✅ | ❌ | — | — | ❌ | Deprioritize (post-MVP) |

---

## 4. Scope & Delivery: Gates + Impact Measurement

| Criterion | Target | Current | Status |
|-----------|--------|---------|--------|
| Quality gates per milestone | ✅ | ✅ | DONE |
| Acceptance criteria snapshots | ✅ | ✅ | DONE |
| Scope change workflow | ✅ | ✅ | DONE |
| **Scope compliance dashboard** | ✅ | ❌ | Week 2 (org dashboard) |
| **Milestone burndown chart** | ✅ | ❌ | Week 3 (enhancement) |
| **Delivery metrics** (cycle time, bug escape) | ✅ | ❌ | Post-MVP (week 13+) |
| Builder specialization (Bolt, Lovable, V0) | ✅ | 🟡 | Weeks 9-10 |

---

## 5. Enterprise & Acquisition Readiness

| Criterion | Target | Current | EOW12 | Blocker? |
|-----------|--------|---------|-------|----------|
| **Published benchmarks** (detection rates) | ✅ | ❌ | ✅ | Medium |
| **GitHub integration** (webhooks, status) | ✅ | ❌ | ✅ | High |
| **Org dashboards** (health trends, risk) | ✅ | ❌ | ✅ | High |
| **RBAC + audit logging** | ✅ | ❌ | 🟡 | Low |
| **VPC/on-prem docs** | ✅ | ❌ | 🟡 | Low |
| Data moat (labeled dataset) | ✅ | ❌ | ❌ | Low (post-MVP) |
| GitLab/Azure integration | ✅ | ❌ | ❌ | Low (post-MVP) |

---

## Weekly Checkpoint Template

### Week X Status

**Completed:**
- [ ] Feature 1
- [ ] Feature 2

**In Progress:**
- [ ] Feature 3 (70% done)

**Blockers:**
- [ ] Blocker description → Mitigation

**Quality Metrics:**
- Tests passing: YES/NO
- Build clean: YES/NO
- Coverage: ___%
- Critical issues: __

**Next Week:**
- [ ] Task 1
- [ ] Task 2

---

## Red/Yellow/Green Definitions

### 🟢 GREEN — On track or complete
- Meets acceptance criteria
- Tests passing
- No blockers
- Ready to demo

### 🟡 YELLOW — At risk or in progress
- Partially implemented
- Blocked temporarily (but has mitigation)
- Needs 1–2 more days

### 🔴 RED — Behind or broken
- Failed tests
- Blocker without clear mitigation
- Will miss EOW deadline at current velocity

---

## Monthly Cadence

### Month 1 (Weeks 1–4): Dashboards + GitHub Integration
- **Goals:** 
  - Org, health trend, scope, hotspot dashboards live
  - GitHub webhooks auto-trigger scans
  - PR status checks enforced
  - Ready for closed-beta user testing

- **Success criteria:**
  - Dashboards visible to beta users
  - 0 critical bugs on closed-beta
  - GitHub auto-scan working on 5+ test repos
  - No regression in existing scan quality

### Month 2 (Weeks 5–8): Benchmarks + Builder Specialization  
- **Goals:**
  - Published benchmarks (50 repos, detection rate, false positives)
  - Bolt-specific rules enforced
  - Lovable portability checks live
  - Landing page updated with "scope-aware" positioning

- **Success criteria:**
  - Benchmark white paper published + linked on website
  - Detection rate ≥ 80%
  - False positive rate ≤ 5%
  - Builder validation rules tested with 3+ projects per builder

### Month 3 (Weeks 9–12): Enterprise Hardening
- **Goals:**
  - RBAC + audit logging live
  - VPC/on-prem deployment guide complete
  - Acquired first enterprise customer (or credible prospect)
  - Acquisition-ready pitch deck finalized

- **Success criteria:**
  - Enterprise customer using RepoRank on internal repos
  - No data retention issues (audit log complete)
  - Demo ready for acquirer (VCs, competitors)

---

## Sample Week 3 Checkpoint (End of Phase 1)

### Dashboards Complete

**Completed:**
- [x] Org dashboard (repos + health + trend)
- [x] Health trendline (10-scan visualization)
- [x] Scope compliance tracker
- [x] Risk hotspots page
- [x] API endpoints for all queries
- [x] Database indexes added

**In Progress:**
- [ ] GitHub integration (webhook receiver 80% done)

**Blockers:**
- None

**Quality:**
- Tests: ✅ All passing
- Build: ✅ Clean
- Coverage: 82%
- Bugs: 0 critical

**Next Week (Week 4–6):**
- [ ] Finish webhook receiver + PR status checks
- [ ] Test with real GitHub repo
- [ ] Lightweight PR comment format
- [ ] Org GitHub App registration

---

## Sample Week 6 Checkpoint (End of Phase 2)

### GitHub Integration Live

**Completed:**
- [x] Webhook receiver (push + PR events)
- [x] PR status checks (blocks low-score PRs)
- [x] Lightweight comment format
- [x] GitHub App marketplace registration
- [x] 5+ test repos connected

**In Progress:**
- [ ] Comparison UI (50% done)

**Blockers:**
- None

**Quality:**
- Tests: ✅ All passing
- Build: ✅ Clean
- Coverage: 84%
- Bugs: 0 critical

**Next Week (Week 7–8):**
- [ ] Finish comparison UI
- [ ] Start benchmark suite (50 repos)
- [ ] Publish benchmark results
- [ ] White paper draft

---

## Sample Week 12 Checkpoint (Acquisition Ready)

### All Phases Complete

**Completed:**
- [x] Dashboards (org, health, scope, risk)
- [x] GitHub integration (webhooks, status, comments)
- [x] Published benchmarks (86% detection rate, 3% false positives)
- [x] Builder specialization (Bolt, Lovable, V0)
- [x] RBAC + audit logging
- [x] VPC/on-prem guide
- [x] Acquisition pitch deck

**In Progress:**
- None (all shipped)

**Blockers:**
- None

**Quality:**
- Tests: ✅ All passing (508 tests)
- Build: ✅ Clean
- Coverage: 87%
- Bugs: 0 critical

**Enterprise Metrics:**
- Dashboard unique users: __
- GitHub scans triggered: __
- Benchmark downloads: __
- Acquisition conversations: 2–3 active

---

## Velocity Tracking

Track story points (or hours) completed per week to forecast on-time delivery:

| Week | Planned | Completed | Velocity | Forecast Status |
|------|---------|-----------|----------|-----------------|
| 1 | 13 | 13 | 100% | ✅ On track |
| 2 | 13 | 12 | 92% | ✅ On track |
| 3 | 13 | 11 | 85% | 🟡 Slight slip (day 1 week 4) |
| 4 | 13 | 13 | 100% | ✅ Recovered |
| 5 | 15 | 14 | 93% | ✅ On track |
| 6 | 15 | 15 | 100% | ✅ On track |
| ... | ... | ... | ... | ... |
| 12 | 16 | 16 | 100% | ✅ Complete |

---

## Go/No-Go Criteria (End of Week 12)

**GO (ready for acquisition pitch):**
- ✅ All 5 criteria scorecard = GREEN/YELLOW (no RED)
- ✅ 0 critical bugs
- ✅ Tests ≥ 85% passing
- ✅ Published benchmarks showing 80%+ detection rate
- ✅ Beta customer feedback positive (NPS ≥ 50)
- ✅ Pitch deck + demo ready
- ✅ Enterprise customer (or warm lead)

**NO-GO (extend roadmap):**
- ❌ Any RED criteria remaining
- ❌ Critical bugs unfixed
- ❌ Benchmarks inconclusive
- ❌ No beta customer interest
- ❌ GitHub integration unstable

---

## Risk Dashboard

| Risk | Probability | Impact | Mitigation | Owner |
|------|-------------|--------|-----------|-------|
| Dashboard performance (slow for large orgs) | Medium | High | Add pagination, lazy loading, caching | Frontend lead |
| GitHub webhooks flaky | Medium | High | Retry logic, dead-letter queue, monitoring | Backend lead |
| Benchmark suite takes 2x time | Low | Medium | Use subset of 20 repos initially, parallelize | QA lead |
| Builder rules too specific | Low | Medium | Limit to 5 most common patterns, versioning | Product lead |
| Enterprise RBAC integration delays | Low | Low | Document, consider v1.1 feature | Backend lead |

---

## Weekly Sync Agenda (30 min)

1. **Checkpoint** (5 min) — Scorecard review, RED items flagged
2. **Blockers** (10 min) — Any stuck stories?
3. **Next week** (10 min) — Assignments, dependencies
4. **Metrics** (5 min) — Velocity, quality, customer feedback

**Owner:** PM or Tech Lead
**Participants:** Eng lead, frontend lead, backend lead, QA
