#!/bin/bash
# PreToolUse hook: block `git commit` when the staged files look like secrets.
# Enforces the security-hygiene rule with a hard backstop — the commit skill's
# "never auto-stage" list is judgment; this is deterministic.
#
# Exit codes: 0 = allow, 2 = block (stderr is shown to Claude).

set -u

command -v jq >/dev/null 2>&1 || exit 0  # can't parse input without jq; don't block

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

staged=$(git diff --staged --name-only 2>/dev/null) || exit 0
[ -n "$staged" ] || exit 0

bad=$(printf '%s\n' "$staged" | grep -E '(^|/)\.env(\..+)?$|\.pem$|(^|/)id_rsa[^/]*$|(^|/)credentials\.json$|(^|/)secrets/' | grep -vE '\.env\.example$|\.env\.sample$|\.env\.template$')

if [ -n "$bad" ]; then
  {
    echo "BLOCKED: staged files look like secrets (security-hygiene rule):"
    printf '%s\n' "$bad"
    echo "Unstage them (git restore --staged <file>) or, if they are safe placeholders, ask the user to commit them explicitly."
  } >&2
  exit 2
fi

exit 0
