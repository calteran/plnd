#!/usr/bin/env bash
# Entrypoint for the Ollama container: starts the server, waits for it to be
# ready, pulls configured models (if not already cached), then yields to the
# server process.
set -euo pipefail

FAST_MODEL="${OLLAMA_FAST_MODEL:-phi3}"
CAPABLE_MODEL="${OLLAMA_CAPABLE_MODEL:-llama3.2}"

ollama serve &
SERVER_PID=$!

echo "-> Waiting for Ollama to start..."
until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 1
done

pull_if_missing() {
  local model="$1"
  if ollama list | grep -q "^${model}"; then
    echo "-> Model already cached: $model"
  else
    echo "-> Pulling model: $model"
    ollama pull "$model"
  fi
}

pull_if_missing "$FAST_MODEL"
if [ "$CAPABLE_MODEL" != "$FAST_MODEL" ]; then
  pull_if_missing "$CAPABLE_MODEL"
fi

echo "-> Ollama ready (fast: $FAST_MODEL, capable: $CAPABLE_MODEL)"

wait "$SERVER_PID"
