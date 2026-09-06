#!/usr/bin/env bash
# WorktreeCreate hook: put agent worktrees OUTSIDE this repository.
#
# Why this exists
# ---------------
# By default Claude Code creates isolation worktrees under
# <repo>/.claude/worktrees/<name>. That has two costs in this repo:
#
#   1. `.claude/` shows up as untracked in every `git status`.
#   2. The obvious fix -- adding `.claude/` to `.gitignore` -- makes Claude
#      Code REFUSE the worktree ("Refusing to use ... as an isolation
#      worktree"). `.git/info/exclude` fails identically; it is the same
#      mechanism in a different file. See issue #56 for the A/B evidence.
#
# Putting the worktrees outside the repository dissolves both problems: there
# is nothing untracked to ignore, and no checkout nested inside the working
# tree. This is the mechanism the Claude Code docs point at for relocating
# worktrees ("Replace worktree creation with a hook").
#
# NOTE: settings.json also has a `worktree.location` key. It does NOT work for
# this -- its own schema says "The CLI (--worktree, EnterWorktree, agent
# isolation) does not read it yet." It is for Desktop SSH sessions only.
#
# Contract
# --------
# stdin : JSON describing the requested worktree; `.name` is the branch/dir name.
# stdout: the absolute path of the created worktree, and nothing else.
# stderr: everything else (git's own chatter must not pollute stdout).
# exit 0 on success.
#
# `jq` is deliberately NOT used -- it is not installed on this machine, and a
# missing jq would make this hook fail in a way that looks like broken worktree
# isolation rather than a missing dependency. Node is already required by this
# project (see .nvmrc), so parsing stdin with node is the safer dependency.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"

# Read the hook payload and extract .name. Falls back to a timestamp so a
# payload shape change degrades to "worktree with an ugly name" rather than
# "worktree creation is broken".
NAME="$(node -e '
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let name = "";
    try {
      name = (JSON.parse(raw) || {}).name || "";
    } catch {
      // fall through to the timestamp below
    }
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      name = "wt-" + Date.now();
    }
    process.stdout.write(name);
  });
')"

# Worktrees live beside the repo, never inside it.
DEST_ROOT="${CLAUDE_WORKTREE_ROOT:-$HOME/.claude-worktrees/$REPO_NAME}"
DEST="$DEST_ROOT/$NAME"

mkdir -p "$DEST_ROOT" >&2

# Reuse an existing worktree at this path rather than failing the dispatch.
if [ -e "$DEST" ]; then
  echo "worktree path already exists, reusing: $DEST" >&2
else
  git -C "$REPO_ROOT" worktree add --detach "$DEST" HEAD >&2
fi

# stdout carries the path and nothing else.
#
# On Windows this script runs under Git Bash, where "$HOME" is an MSYS path
# (/c/Users/...). Claude Code is a Node process using native Windows paths, and
# would not resolve that form -- so convert before printing. `cygpath -m` gives
# C:/Users/... (forward slashes, native drive), which both git and Node accept
# without the backslash-escaping hazards of `cygpath -w`.
if command -v cygpath >/dev/null 2>&1; then
  cygpath -m "$DEST"
else
  echo "$DEST"
fi
