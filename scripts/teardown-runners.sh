#!/usr/bin/env bash
# scripts/teardown-runners.sh — Deregister all self-hosted runners from this machine
#
# Usage:
#   ./scripts/teardown-runners.sh
#   just teardown-runners
#
# Discovers every OrbStack VM named <hostname>-1, <hostname>-2, … (matching the
# naming scheme used by setup-runner.sh), deregisters each from GitHub Actions,
# stops its runner service, and deletes the VM.

set -euo pipefail
export GH_PAGER=cat   # prevent gh from invoking less when stdout is a TTY

REPO_URL="https://github.com/calteran/plnd"

# ── Discover runner VMs ───────────────────────────────────────────────────────
# Mirrors the naming logic in setup-runner.sh: <hostname>-<N>
_machine=$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-*$//')

VM_NAMES=()
_n=1
while orb info "plnd-${_machine}-${_n}" &>/dev/null; do
    VM_NAMES+=("plnd-${_machine}-${_n}")
    _n=$((_n + 1))
done
unset _machine _n

if [[ ${#VM_NAMES[@]} -eq 0 ]]; then
    echo "✓ No runner VMs found for this machine."
    exit 0
fi

echo "◆ Tearing down ${#VM_NAMES[@]} runner(s): ${VM_NAMES[*]}"

OVERALL=0

for VM_NAME in "${VM_NAMES[@]}"; do
    echo ""
    echo "  ── $VM_NAME ──"

    # ── Deregister from GitHub ────────────────────────────────────────────────
    echo "    → Deregistering from GitHub..."
    if ! command -v gh &>/dev/null; then
        echo "    ✗ gh not found — deregister manually at: $REPO_URL/settings/actions/runners"
        OVERALL=1
    else
        RUNNER_ID=$(gh api "repos/calteran/plnd/actions/runners" \
            --jq ".runners[] | select(.name==\"$VM_NAME\") | .id" 2>/dev/null || true)
        if [[ -n "$RUNNER_ID" ]]; then
            gh api -X DELETE "repos/calteran/plnd/actions/runners/$RUNNER_ID" 2>/dev/null || true
            echo "    ✓ Deregistered (GitHub id: $RUNNER_ID)"
        else
            echo "    ✓ Not found on GitHub (already removed)"
        fi
    fi

    # ── Stop runner service inside VM ─────────────────────────────────────────
    echo "    → Stopping runner service..."
    orb run -m "$VM_NAME" bash -c '
        set -euo pipefail
        if ! systemctl list-unit-files --type=service 2>/dev/null | grep -q "actions.runner"; then
            echo "Service not installed — skipping"
            exit 0
        fi
        cd $HOME/actions-runner
        sudo ./svc.sh stop      2>/dev/null || true
        sudo ./svc.sh uninstall 2>/dev/null || true
    ' 2>/dev/null || true
    echo "    ✓ Service stopped"

    # ── Delete the VM ─────────────────────────────────────────────────────────
    echo "    → Deleting VM..."
    if orb delete "$VM_NAME" 2>/dev/null; then
        echo "    ✓ VM deleted"
    else
        echo "    ✗ VM delete failed — remove manually with: orb delete $VM_NAME"
        OVERALL=1
    fi
done

echo ""
if [[ $OVERALL -eq 0 ]]; then
    echo "✅ All runners torn down."
else
    echo "⚠️  Teardown completed with errors — check output above."
fi
echo "   Monitor at: $REPO_URL/settings/actions/runners"

exit $OVERALL
