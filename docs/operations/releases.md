# Releases

An engine release is a container image, `ghcr.io/wolfymaster/woofx3`, built
from `Dockerfile.production` by `.github/workflows/release.yml`. What an engine
runs is always an immutable **digest**; a tag is only how people and the
maintenance API find one.

## Tags

| Tag | Published by | Meaning |
|---|---|---|
| `vMAJOR.MINOR.PATCH` | the release workflow, on a push to `master` | A release. Never re-pushed or moved. |
| `pr-<n>-<sha7>` | the preview-engine workflow | A preview of pull request `<n>` at commit `<sha7>`. Short-lived. |
| `latest` | every release | The newest release. Moves; nothing deploys it. |

The image's `WOOFX3_VERSION` build argument is the tag, verbatim: `v0.1.0` for a
release, `pr-42-a1b2c3d` for a preview. The engine reports it
unchanged as `version` in `GET /ready` and `getEngineInfo`, and the maintenance
API compares it exactly with the release it deployed. A build without the
argument reports `dev`.

## What a release publishes

- The image, tagged `v…` and `latest`.
- A GitHub release whose notes carry the image **digest** (`sha256:…`), and
  `ghcr.io/wolfymaster/woofx3@<digest>` as the reference to deploy.
- `woofx3-v…-linux-amd64.zip`, extracted from the image, and
  `woofx3-v…-windows-amd64.zip`, cross-compiled separately. Each holds the
  orchestrator and every service binary, and starts through `start.sh` /
  `start.bat`, which migrate the database before starting the orchestrator, as
  the image's entrypoint does.

## Cutting a release

Releases are cut by [semantic-release](https://semantic-release.gitbook.io/)
(configured in `.releaserc.json`) on every push to `master`. It reads the
[Conventional Commits](https://www.conventionalcommits.org/) since the last
`v*` tag and picks the next version:

| Commits since the last release | Bump |
|---|---|
| a breaking change (`feat!:`, `BREAKING CHANGE:` footer) | minor |
| `feat` | minor |
| `fix`, `perf` | patch |
| anything else (`ci`, `docs`, `chore`, `refactor`, ...) | no release |

A breaking change bumps the minor version while the engine is below `1.0.0`.
Going to `1.0.0` means tagging it by hand and removing the `breaking` rule from
`.releaserc.json`, after which a breaking change bumps the major version.

The workflow settles the version first, with a dry run, because the image is
built with it. It then builds the image (pushed by digest, untagged) and both
archives, and only when all three exist creates the git tag, the GitHub release
with the archives attached, and the image's `v…` and `latest` tags. A release
therefore never exists without its artifacts.

Releases are cut one at a time. If another commit lands on `master` while one
is building, that run fails at publishing rather than release artifacts whose
version its tag no longer matches, and the next run releases both.

When the workflow finishes, check the release notes carry the digest, and that
`docker pull ghcr.io/wolfymaster/woofx3@<digest>` works.

## Visibility

Managed engines are deployed by pulling the image anonymously, so the GHCR
package must be **public**. Changing the package's visibility is a one-time
step taken in GitHub's package settings, not by the workflow.
