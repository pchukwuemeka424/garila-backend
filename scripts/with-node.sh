#!/usr/bin/env bash
# Run a command with a supported Node.js (20.19–25.x) that actually starts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE25_DIR="${FEYNMAN_NODE25_DIR:-$HOME/.local/node/v25.2.1}"
NODE25_BIN="$NODE25_DIR/bin/node"

is_supported_version() {
	local version="${1#v}"
	local major minor patch
	major="$(echo "$version" | cut -d. -f1)"
	minor="$(echo "$version" | cut -d. -f2)"
	patch="$(echo "$version" | cut -d. -f3)"
	[[ "$major" -le 25 ]] || return 1
	if [[ "$major" -eq 20 ]]; then
		[[ "$minor" -gt 19 || ( "$minor" -eq 19 && "$patch" -ge 0 ) ]] || return 1
	fi
	return 0
}

node_runs() {
	local bin="$1"
	( "$bin" -e "process.exit(0)" >/dev/null 2>&1 )
}

try_node() {
	local bin="$1"
	[[ -x "$bin" ]] || return 1
	node_runs "$bin" || return 1
	local version
	version="$("$bin" -v 2>/dev/null)" || return 1
	is_supported_version "$version" || return 1
	echo "$bin"
}

ensure_node25() {
	[[ -x "$NODE25_BIN" ]] && return 0
	echo "Installing Node.js v25.2.1 to $NODE25_DIR ..." >&2
	local arch os tarball url tmp
	os="$(uname -s | tr '[:upper:]' '[:lower:]')"
	arch="$(uname -m)"
	case "$arch" in
		x86_64) arch="x64" ;;
		arm64) arch="arm64" ;;
	esac
	tarball="node-v25.2.1-${os}-${arch}.tar.gz"
	url="https://nodejs.org/dist/v25.2.1/$tarball"
	tmp="$(mktemp -t feynman-node25.XXXXXX.tar.gz)"
	curl -fsSL "$url" -o "$tmp"
	mkdir -p "$(dirname "$NODE25_DIR")"
	rm -rf "$NODE25_DIR"
	tar -xzf "$tmp" -C "$(dirname "$NODE25_DIR")"
	mv "$(dirname "$NODE25_DIR")/node-v25.2.1-${os}-${arch}" "$NODE25_DIR"
	rm -f "$tmp"
}

find_node() {
	local found

	if [[ -n "${FEYNMAN_NODE:-}" ]]; then
		found="$(try_node "$FEYNMAN_NODE" || true)"
		if [[ -n "$found" ]]; then
			echo "$found"
			return 0
		fi
		echo "FEYNMAN_NODE is set but not a working supported Node: $FEYNMAN_NODE" >&2
		exit 1
	fi

	ensure_node25
	found="$(try_node "$NODE25_BIN" || true)"
	if [[ -n "$found" ]]; then
		echo "$found"
		return 0
	fi

	if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
		# shellcheck disable=SC1090
		source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
		local nvmrc="$BACKEND_ROOT/../.nvmrc"
		[[ -f "$nvmrc" ]] || nvmrc="$BACKEND_ROOT/.nvmrc"
		if [[ -f "$nvmrc" ]]; then
			nvm install "$(tr -d '[:space:]' < "$nvmrc")" >/dev/null 2>&1 || true
			nvm use --silent >/dev/null 2>&1 || nvm use "$(tr -d '[:space:]' < "$nvmrc")" >/dev/null 2>&1 || true
			local current
			current="$(command -v node 2>/dev/null || true)"
			if [[ -n "$current" ]]; then
				found="$(try_node "$current" || true)"
				if [[ -n "$found" ]]; then
					echo "$found"
					return 0
				fi
			fi
		fi
	fi

	local current
	current="$(command -v node 2>/dev/null || true)"
	if [[ -n "$current" ]]; then
		found="$(try_node "$current" || true)"
		if [[ -n "$found" ]]; then
			echo "$found"
			return 0
		fi
	fi

	echo "No working Node.js 20.19–25.x found." >&2
	echo "  Run: bash backend/scripts/with-node.sh node -v  (auto-installs Node 25)" >&2
	exit 1
}

NODE_BIN="$(find_node)"
export PATH="$(dirname "$NODE_BIN"):$PATH"

cd "$BACKEND_ROOT"
exec env PATH="$(dirname "$NODE_BIN"):$PATH" "$@"
