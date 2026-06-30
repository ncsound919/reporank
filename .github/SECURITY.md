# Security Policy

## Reporting a Vulnerability

Please do **not** open public GitHub issues for suspected security vulnerabilities.

Instead, report vulnerabilities privately through GitHub Security Advisories:

1. Go to the repository’s **Security & quality** tab.
2. Select **Report a vulnerability**.
3. Submit the advisory with a clear description, impact, affected components, and reproduction steps.

Direct advisory link:

- [Report a vulnerability](https://github.com/ncsound919/reporank/security/advisories/new)

When possible, include:

- A description of the issue and why it matters.
- Affected package, service, or workflow.
- Steps to reproduce.
- Proof of concept, logs, or screenshots if relevant.
- Suggested remediation, if known.

## Response Commitment

RepoRank maintainers aim to:

- Acknowledge new vulnerability reports within 48 hours.
- Provide an initial triage update after review.
- Coordinate remediation and disclosure timing when a report is valid.

Response times are targets, not guarantees, but reports will be handled as quickly as possible.

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ Yes |

Only supported versions receive security fixes.

## Security Coverage

This repository uses multiple security controls in CI and GitHub:

- CodeQL for static application security testing.
- Dependency auditing with `pnpm audit`.
- SBOM generation for dependency inventory.
- License policy checks in CI.
- Additional RepoRank-specific quality and security analysis in repository workflows.

Security findings may appear in the repository’s **Security & quality** area, depending on the scan type and GitHub feature support. Some findings are surfaced through workflow logs and uploaded artifacts instead of repository-native alerts. [web:443][web:444][web:450]

## Disclosure Guidance

Please allow time for investigation and remediation before public disclosure.

After a fix is available, maintainers may publish a security advisory or release note describing the issue, impact, and remediation path.
