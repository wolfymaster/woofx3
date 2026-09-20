# Releases

An engine release is a container image, `ghcr.io/wolfymaster/woofx3`, built
from `Dockerfile.production` by `.github/workflows/release.yml`. What an engine
runs is always an immutable **digest**; a tag is only how people and the
maintenance API find one.

## Tags

| Tag | Published by | Meaning |
|---|---|---|
| `vMAJOR.MINOR.PATCH` | pushing a git tag of the same name | A release. Never re-pushed or moved. |
| `pr-<n>-<sha7>` | the preview-engine workflow | A preview of pull request `<n>` at commit `<sha7>`. Short-lived. |
| `latest` | every release | The newest release. Moves; nothing deploys it. |

The image's `WOOFX3_VERSION` build argument is the tag, verbatim: `v0.1.0` for a
release (`GITHUB_REF_NAME`), `pr-42-a1b2c3d` for a preview. The engine reports it
unchanged as `version` in `GET /ready` and `getEngineInfo`, and the maintenance
API compares it exactly with the release it deployed. A build without the
argument reports `dev`.

## What a release publishes

- The image, tagged `v…` and `latest`.
- A GitHub release whose notes carry the image **digest** (`sha256:…`), and
  `ghcr.io/wolfymaster/woofx3@<digest>` as the reference to deploy.
- A Linux archive extracted from the image, and a Windows archive built
  separately. Both start through `start.sh` / `start.bat`, which migrate the
  database before starting the orchestrator, as the image's entrypoint does.

## Cutting a release

1. Merge what the release should contain to `master`.
2. Tag the commit and push the tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. When the workflow finishes, check the release notes carry the digest, and
   that `docker pull ghcr.io/wolfymaster/woofx3@<digest>` works.

Version numbers follow semantic versioning. Until `1.0.0`, a minor bump may
break compatibility (a migration that needs care, or a changed RPC).

## Visibility

Managed engines are deployed by pulling the image anonymously, so the GHCR
package must be **public**. Changing the package's visibility is a one-time
step taken in GitHub's package settings, not by the workflow.
