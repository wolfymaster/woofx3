#!/bin/sh
# Runs stylegate on this repository, layered over stylegate's own rules.
#
# stylegate is a local tool here, never part of CI: its LLM rules run on the
# Claude subscription of the logged-in claude CLI (provider: claude_code in
# .stylegate/config.yaml). The stylegate checkout sits next to this
# repository's main clone (~/code/stylegate beside ~/code/woofx3); every
# worktree finds it through git's common directory. STYLEGATE_HOME and
# STYLEGATE_BIN override where the checkout and the binary are.
#
#   scripts/stylegate.sh review [<base>]  full review of the branch against <base>
#                                         (default origin/master), LLM rules included
#   scripts/stylegate.sh quick            deterministic review of uncommitted changes
#   scripts/stylegate.sh hook             Claude Code Stop hook (reads hook JSON on stdin)
#   scripts/stylegate.sh <args>...        any other stylegate command, e.g.
#                                         decisions summary, rules explain <ID>
#
# Every review enforces draft rules and fails on warnings, so a false positive
# surfaces as a finding to report rather than staying silent.
set -u

top=$(git rev-parse --show-toplevel 2>/dev/null) || {
	echo "stylegate.sh: not inside a git repository" >&2
	exit 2
}
common=$(git -C "$top" rev-parse --path-format=absolute --git-common-dir)
home=${STYLEGATE_HOME:-$(dirname "$(dirname "$common")")/stylegate}
bin=${STYLEGATE_BIN:-$home/bin/stylegate}

missing=""
if [ ! -d "$home/.stylegate" ]; then
	missing="no stylegate checkout at $home (clone wolfymaster/stylegate there or set STYLEGATE_HOME)"
elif [ ! -x "$bin" ]; then
	missing="no stylegate binary at $bin (build it: cd $home && go build -o bin/stylegate ./cmd/stylegate)"
fi

if [ "${1:-}" = "hook" ]; then
	# A missing or broken tool must never trap a Claude session: report it
	# and let Claude stop.
	if [ -n "$missing" ]; then
		printf '{"systemMessage":"stylegate Stop hook skipped: %s"}\n' "$missing"
		exit 0
	fi
fi
if [ -n "$missing" ]; then
	echo "stylegate.sh: $missing" >&2
	exit 2
fi

export STYLEGATE_BASE_ROOT="${STYLEGATE_BASE_ROOT:-$home/.stylegate}"
# Hooks inherit Claude Code's PATH, which often lacks Go's install directory,
# where golangci-lint lives.
PATH="$PATH:${GOBIN:-${GOPATH:-$HOME/go}/bin}"
export PATH

case "${1:-}" in
review)
	base=${2:-origin/master}
	exec "$bin" check -C "$top" --base "$base" --include-drafts --fail-on warn
	;;
quick)
	exec "$bin" check -C "$top" --base HEAD --include-drafts --fail-on warn --no-llm
	;;
hook)
	"$bin" hook stop -C "$top" --include-drafts --fail-on warn
	rc=$?
	if [ "$rc" -ne 0 ]; then
		echo "stylegate Stop hook failed (exit $rc); if $bin is stale, rebuild it" >&2
		exit 1
	fi
	;;
*)
	exec "$bin" "$@"
	;;
esac
