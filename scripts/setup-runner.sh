#!/usr/bin/env bash
# scripts/setup-runner.sh — Provision an OrbStack Linux VM as a GitHub Actions self-hosted runner
#
# Usage:
#   ./scripts/setup-runner.sh [--token <TOKEN>] [--name <NAME>] [--labels <LABELS>]
#   just setup-runner            # token auto-fetched via gh CLI; name auto-generated
#   just setup-runner my-mac-2   # pin a specific VM name
#
# Creates an OrbStack Ubuntu 24.04 VM and registers it as a self-hosted runner.
# Pre-installs only what the CI workflows actually require on the host:
#   • Docker       — service containers (postgres) + manual docker run (mock-oauth)
#   • git + curl   — checkout and health-check steps
#   • build-essential + libssl-dev — Rust compilation deps (gcc, linker, openssl-sys)
#   • jq           — JSON parsing utilities
# Rust and Node.js are intentionally left to the per-job actions (dtolnay/rust-toolchain,
# actions/setup-node) so version pinning in rust-toolchain.toml and .nvmrc is respected.

set -euo pipefail

REPO_URL="https://github.com/calteran/plnd"
RUNNER_TOKEN=""
VM_NAME=""   # auto-set after arg parsing: <hostname>-<N>
RUNNER_ARCH_LABEL="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
RUNNER_LABELS="self-hosted,linux,${RUNNER_ARCH_LABEL}"

# ── Argument parsing ──────────────────────────────────────────────────────────
usage() {
    cat >&2 <<EOF
Usage: $(basename "$0") [--token <TOKEN>] [--name <NAME>] [--labels <LABELS>]

  --token   GitHub runner registration token (auto-fetched via gh CLI if omitted)
            Obtain manually at: $REPO_URL/settings/actions/runners/new
  --name    VM and runner name (default: plnd-<hostname>-<N>, e.g. plnd-my-mac-1)
  --labels  Comma-separated runner labels (default: self-hosted,linux,x64)
EOF
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --token)   RUNNER_TOKEN="$2"; shift 2 ;;
        --name)    VM_NAME="$2";      shift 2 ;;
        --labels)  RUNNER_LABELS="$2"; shift 2 ;;
        -h|--help) usage 0 ;;
        *) echo "✗ Unknown argument: $1" >&2; usage 1 ;;
    esac
done

# ── Defaults that depend on the environment ──────────────────────────────────
# Auto-name: <hostname>-1, <hostname>-2, … — supports multiple runners per machine
if [[ -z "$VM_NAME" ]]; then
    _machine=$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-*$//')
    _n=1
    while orb info "plnd-${_machine}-${_n}" &>/dev/null; do _n=$((_n + 1)); done
    VM_NAME="plnd-${_machine}-${_n}"
    unset _machine _n
fi

# Auto-fetch token via gh CLI if not supplied on the command line
if [[ -z "$RUNNER_TOKEN" ]]; then
    if ! command -v gh &>/dev/null; then
        echo "✗ --token is required (or install gh CLI and run 'gh auth login')" >&2
        usage 1
    fi
    echo "  → Fetching runner registration token via gh..."
    RUNNER_TOKEN=$(gh api -X POST "repos/calteran/plnd/actions/runners/registration-token" --jq '.token')
    echo "  ✓ Token acquired"
fi

# ── Prerequisites (host side) ─────────────────────────────────────────────────
if ! command -v orb &>/dev/null; then
    echo "✗ 'orb' not found — install OrbStack: https://orbstack.dev" >&2
    exit 1
fi

echo "◆ Setting up GitHub Actions runner: $VM_NAME"

# ── VM creation (idempotent) ──────────────────────────────────────────────────
if orb info "$VM_NAME" &>/dev/null; then
    echo "  ✓ VM '$VM_NAME' already exists — skipping creation"
else
    echo "  → Creating OrbStack Ubuntu 24.04 VM '$VM_NAME'..."
    orb create ubuntu:24.04 "$VM_NAME"
    echo "  ✓ VM created"
fi

# ── Helper: run a command inside the VM ──────────────────────────────────────
vm() { orb run -m "$VM_NAME" "$@"; }

# ── System packages ───────────────────────────────────────────────────────────
echo "  → Installing system packages..."
vm bash -c '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get update -qq
    sudo apt-get install -y -qq \
        build-essential curl git jq pkg-config libssl-dev ca-certificates gnupg lsb-release \
        unzip
'
echo "  ✓ System packages installed"

# ── Chromium (for Angular unit tests via karma-chrome-launcher) ───────────────
echo "  → Installing Chromium..."
vm bash -c '
    set -euo pipefail
    if command -v chromium &>/dev/null || command -v chromium-browser &>/dev/null; then
        echo "Chromium already installed — skipping"
        exit 0
    fi
    export DEBIAN_FRONTEND=noninteractive
    # Install Chromium dependencies then the snap package.
    # On Ubuntu 24.04, chromium-browser from apt is a snap transitional package;
    # installing the snap directly is more reliable in OrbStack VMs.
    sudo apt-get install -y -qq snapd
    sudo snap install chromium
'
echo "  ✓ Chromium installed"

# ── GitHub CLI (gh) — required by JetBrains Junie action ─────────────────────
echo "  → Installing GitHub CLI..."
vm bash -c '
    set -euo pipefail
    if command -v gh &>/dev/null; then
        echo "gh already installed — skipping"
        exit 0
    fi
    export DEBIAN_FRONTEND=noninteractive
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
    sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -qq gh
'
echo "  ✓ GitHub CLI installed"

# ── Docker ────────────────────────────────────────────────────────────────────
echo "  → Installing Docker..."
vm bash -c '
    set -euo pipefail
    if command -v docker &>/dev/null; then exit 0; fi
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get install -y -qq docker.io
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -aG docker "$USER"
'
echo "  ✓ Docker installed"

# ── GitHub Actions runner binary ──────────────────────────────────────────────
echo "  → Downloading GitHub Actions runner..."
vm bash -c '
    set -euo pipefail
    RUNNER_DIR="$HOME/actions-runner"
    if [[ -x "$RUNNER_DIR/run.sh" ]]; then
        echo "Runner binary already present — skipping download"
        exit 0
    fi
    # Map uname -m to GitHub runner arch names
    case "$(uname -m)" in
        x86_64)  RUNNER_ARCH="x64" ;;
        aarch64) RUNNER_ARCH="arm64" ;;
        *) echo "✗ Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"
    VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
        | jq -r .tag_name | sed "s/^v//")
    echo "Fetching runner v$VERSION ($RUNNER_ARCH)..."
    curl -fsSL \
        "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-${RUNNER_ARCH}-${VERSION}.tar.gz" \
        | tar xzf -
'
echo "  ✓ Runner binary ready"

# ── Register runner ───────────────────────────────────────────────────────────
# Always run config.sh --replace: the token is required and single-use, so this
# is an intentional re-registration. --replace handles existing registrations on
# the GitHub side; any stale .runner credentials from a prior run are overwritten.
echo "  → Registering runner with GitHub..."
vm bash -c "
    set -euo pipefail
    cd \$HOME/actions-runner
    # Remove local credential files so config.sh always runs fresh.
    # --replace handles the GitHub-side duplicate; these handle the local side.
    rm -f .runner .credentials .credentials_rsaparams
    ./config.sh \
        --url '$REPO_URL' \
        --token '$RUNNER_TOKEN' \
        --name '$VM_NAME' \
        --labels '$RUNNER_LABELS' \
        --unattended \
        --replace
"
echo "  ✓ Runner registered"

# ── Docker cleanup hooks ──────────────────────────────────────────────────────
# Self-hosted runners don't get a fresh environment per job the way hosted runners do.
# These hooks prune leftover containers so workflows stay host-agnostic.
echo "  → Configuring Docker cleanup hooks..."
vm bash -c '
    set -euo pipefail
    HOOKS_DIR="$HOME/actions-runner/_hooks"
    mkdir -p "$HOOKS_DIR"

    # post-job: remove containers that were stopped during the job (normal completion).
    # Service containers are still running at this point and will not be pruned.
    cat > "$HOOKS_DIR/post-job-cleanup.sh" <<'"'"'HOOK'"'"'
#!/usr/bin/env bash
docker container prune -f 2>/dev/null || true
HOOK

    # pre-job: stop and remove any containers that are STILL RUNNING from a previous
    # job (e.g., job was cancelled mid-run). Service containers for the current job
    # have already been started on a github_network_* network — leave those alone.
    cat > "$HOOKS_DIR/pre-job-cleanup.sh" <<'"'"'HOOK'"'"'
#!/usr/bin/env bash
GITHUB_NETS=$(docker network ls --format "{{.Name}}" 2>/dev/null | grep "^github_network_" || true)
docker ps -q 2>/dev/null | while read -r cid; do
    NETS=$(docker inspect "$cid" -f "{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}" 2>/dev/null || true)
    on_github_net=false
    for net in $GITHUB_NETS; do
        [[ "$NETS" == *"$net"* ]] && on_github_net=true && break
    done
    if [[ "$on_github_net" == false ]]; then
        docker stop "$cid" 2>/dev/null || true
    fi
done
docker container prune -f 2>/dev/null || true
HOOK

    chmod +x "$HOOKS_DIR/post-job-cleanup.sh" "$HOOKS_DIR/pre-job-cleanup.sh"

    # Register hooks in the runner .env (runner reads this on startup)
    ENV_FILE="$HOME/actions-runner/.env"
    touch "$ENV_FILE"
    grep -v "^ACTIONS_RUNNER_HOOK_JOB_\|^CHROMIUM_FLAGS\|^CHROME_BIN\|^PATH=" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE" || true
    echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=$HOME/actions-runner/_hooks/pre-job-cleanup.sh"  >> "$ENV_FILE"
    echo "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$HOME/actions-runner/_hooks/post-job-cleanup.sh" >> "$ENV_FILE"
    # Chromium flags: --no-sandbox is required in VMs (no user namespace support).
    # CHROME_BIN: karma-chrome-launcher looks for chromium-browser or google-chrome;
    # snap installs chromium at /snap/bin/chromium, so we point to it explicitly.
    echo "CHROMIUM_FLAGS=--no-sandbox" >> "$ENV_FILE"
    echo "CHROME_BIN=/snap/bin/chromium" >> "$ENV_FILE"
    # Include ~/.local/bin so tools installed there (e.g. junie from JetBrains/junie-github-action)
    # are found in subsequent steps. The runner .env file is read as key=value (not shell), so
    # $HOME is expanded here at setup time rather than job time.
    echo "PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin" >> "$ENV_FILE"
'
echo "  ✓ Docker cleanup hooks configured"

# ── Install and start runner service ──────────────────────────────────────────
echo "  → Installing runner as a systemd service..."
vm bash -c '
    set -euo pipefail
    cd $HOME/actions-runner
    # Always stop/uninstall first — svc.sh install fails if unit file already exists.
    # These are no-ops (exit non-zero, silenced) when nothing is installed.
    sudo ./svc.sh stop      2>/dev/null || true
    sudo ./svc.sh uninstall 2>/dev/null || true
    sudo ./svc.sh install
    sudo ./svc.sh start
'
echo "  ✓ Runner service active"

echo ""
echo "✅ Runner '$VM_NAME' is live. Run 'just teardown-runner' to stop and deregister."
echo "   Monitor at: $REPO_URL/settings/actions/runners"
