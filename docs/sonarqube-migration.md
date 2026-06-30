# SonarQube to RepoRank Migration Guide

Reporank can import existing SonarQube configurations, providing a smooth migration path for enterprises that use SonarQube for code quality analysis.

## Quick Start

Import a SonarQube quality profile:

```bash
reporank import sonarqube --profile ./sonar-profile.xml
```

Import an issue report with quality gate:

```bash
reporank import sonarqube --profile ./sonar-profile.xml --issues ./issues.json --quality-gate ./quality-gate.json
```

Generate a RepoRank config file:

```bash
reporank import sonarqube --profile ./sonar-profile.xml --output reporank-config > reporank.config.json
```

## Supported Inputs

### Quality Profile XML

Export from SonarQube: **Quality Profiles > your-profile > Backup** (or use the SonarQube Web API `api/qualityprofiles/backup`).

Standard format:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<profile>
  <name>Sonar way (TypeScript)</name>
  <language>ts</language>
  <rules>
    <rule>
      <repositoryKey>typescript</repositoryKey>
      <key>S1125</key>
      <priority>MAJOR</priority>
    </rule>
  </rules>
</profile>
```

### Issue Report JSON

Export from SonarQube Web API `api/issues/search`.

Standard format:

```json
{
  "issues": [
    {
      "rule": "typescript:S1125",
      "severity": "MAJOR",
      "component": "src/utils.ts",
      "message": "Remove the unnecessary boolean literal.",
      "line": 42,
      "type": "CODE_SMELL"
    }
  ]
}
```

### Quality Gate JSON

Export from SonarQube Web API `api/qualitygates/show`.

```json
{
  "name": "Sonar way (default)",
  "conditions": [
    { "metric": "blocker_violations", "op": "GT", "error": "0" }
  ]
}
```

## Severity Mapping

| SonarQube Severity | RepoRank Weight |
|-------------------|-----------------|
| BLOCKER           | 0.95            |
| CRITICAL          | 0.85            |
| MAJOR             | 0.70            |
| MINOR             | 0.50            |
| INFO              | 0.25            |

## Rule Type Mapping

| SonarQube Type      | RepoRank Category   |
|--------------------|---------------------|
| BUG                | reliability         |
| VULNERABILITY      | security            |
| CODE_SMELL         | maintainability     |
| SECURITY_HOTSPOT   | security            |

## Quality Gate Metric Mapping

| SonarQube Metric              | RepoRank Metric          |
|------------------------------|--------------------------|
| blocker_violations           | blockers                 |
| critical_violations          | critical_issues          |
| major_violations             | major_issues             |
| minor_violations             | minor_issues             |
| code_smells                  | code_smells              |
| bugs                         | bugs                     |
| vulnerabilities              | vulnerabilities          |
| coverage                     | test_coverage            |
| duplicated_lines_density     | duplication              |
| sqale_rating                 | maintainability_rating   |
| reliability_rating           | reliability_rating       |
| security_rating              | security_rating          |
| security_hotspots_reviewed   | security_hotspots        |

## Migration Report Output

The `json` output format (default) produces a migration report with:

- **mappedRules**: All rules converted to RepoRank format with weights and categories
- **mappedIssues**: All issues mapped to RepoRank format
- **unmappedRuleTypes**: Repository keys that couldn't be automatically categorized
- **coverage**: Percentage of rules successfully mapped (target: > 80%)
- **gaps**: RepoRank categories with no corresponding SonarQube rules
- **summary**: Human-readable migration summary

## RepoRank Config Output

The `reporank-config` output format generates a `reporank.config.json` file that can be used directly for grading.

Example:

```json
{
  "$schema": "https://reporank.dev/schemas/config-v0.1.json",
  "generator": "reporank import sonarqube",
  "rules": [
    {
      "ruleKey": "S1125",
      "source": "sonarqube:typescript",
      "weight": 0.7,
      "category": "maintainability",
      "parameters": { "max": "3" }
    }
  ],
  "thresholds": {
    "blockers": { "operator": "GT", "error": 0 }
  }
}
```

## Limitations

- Custom SonarQube plugin rules without recognizable repository key patterns are mapped to `unknown` category
- Metrics not in the standard mapping table are passed through unchanged
- The importer does not connect to a live SonarQube instance — use exported files
