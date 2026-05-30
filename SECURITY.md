# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via GitHub's
[private vulnerability reporting](https://github.com/discostu105/grafana-grail-datasource/security/advisories/new)
("Report a vulnerability" under the **Security** tab). We aim to acknowledge
reports within a few business days and will keep you updated as we investigate.

When reporting, please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof of concept.
- The plugin version and Grafana version affected.

## Supported versions

Security fixes are applied to the latest released version. Please upgrade to the
latest release before reporting.

## Handling of secrets

- The Dynatrace API token is stored using Grafana's encrypted
  `secureJsonData` and is never written to `jsonData`, logs, or frontend state.
- The token is only used server-side (in the plugin backend) to authenticate
  requests to your Dynatrace tenant.
- No query data, tokens, or telemetry are sent anywhere other than the
  configured Dynatrace tenant.
