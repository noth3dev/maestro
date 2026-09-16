#!/bin/sh
set -eu

MIN_NODE_MAJOR=24
NPM_COMMAND=${MAESTRO_INSTALL_NPM:-npm}
PACKAGE_NAME=${MAESTRO_NPM_PACKAGE:-@maestro/cli}
PACKAGE_VERSION=${MAESTRO_NPM_VERSION:-0.1.0}

if ! command -v node >/dev/null 2>&1; then
  echo "Maestro requires Node.js ${MIN_NODE_MAJOR} or newer; node was not found. Install Node.js and retry." >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  echo "Maestro requires Node.js ${MIN_NODE_MAJOR} or newer; found Node.js ${NODE_MAJOR}. Upgrade Node.js and retry." >&2
  exit 1
fi
if ! command -v "$NPM_COMMAND" >/dev/null 2>&1; then
  echo "Maestro requires npm to install ${PACKAGE_NAME}; ${NPM_COMMAND} was not found." >&2
  exit 1
fi

"$NPM_COMMAND" install --global --no-fund --no-audit "${PACKAGE_NAME}@${PACKAGE_VERSION}"
PREFIX=$("$NPM_COMMAND" config get prefix)
BIN_DIR=${PREFIX}/bin
echo "Installed ${PACKAGE_NAME}@${PACKAGE_VERSION}."
case ":${PATH:-}:" in
  *":${BIN_DIR}:"*) echo "Run: maestro --version" ;;
  *) echo "${BIN_DIR} is not in PATH. Start a new shell or run: export PATH=\"${BIN_DIR}:\$PATH\"" ;;
esac
