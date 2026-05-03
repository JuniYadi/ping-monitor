#!/usr/bin/env bash

set -euo pipefail

REPO="JuniYadi/ping-monitor"
ASSET_PREFIX="ping-monitor"

INSTALL_DIR="${HOME}/.local/bin"
CONFIG_DIR="${HOME}/.config/ping-monitor"
BIN_PATH="${INSTALL_DIR}/ping-monitor"
RUNNER_PATH="${INSTALL_DIR}/ping-monitor-runner"
ENV_FILE="${CONFIG_DIR}/ping-monitor.env"

TMP_DIR="$(mktemp -d)"
TMP_BIN="${TMP_DIR}/${ASSET_PREFIX}"

trap 'rm -rf "${TMP_DIR}"' EXIT

die() {
  echo "Error: $*" >&2
  exit 1
}

require_value() {
  local value=$1
  local label=$2

  if [[ -z "${value}" ]]; then
    die "${label} is required"
  fi
}

usage() {
  cat <<'EOF'
Usage: install.sh [--server <server>] [--auth <username:password>]

The installer reads interactive values from terminal unless provided.
EOF
}

prompt_value() {
  local prompt=$1
  local value_name=$2
  local default_value=$3
  local value=""

  if [[ -n "${default_value}" ]]; then
    echo "${default_value}"
    return
  fi

  while true; do
    if ! printf '%s' "${prompt}" > /dev/tty; then
      die "Cannot write to terminal while reading ${value_name}. Set PING_MONITOR_SERVER before running non-interactively."
    fi

    if ! read -r value < /dev/tty; then
      die "Cannot read ${value_name}. Set PING_MONITOR_SERVER before running non-interactively."
    fi

    if [[ -n "${value}" ]]; then
      echo "${value}"
      return
    fi
    echo "${value_name} cannot be empty" >&2
  done
}

prompt_auth() {
  local value=""
  local default_value=$1

  if [[ -n "${default_value}" ]]; then
    echo "${default_value}"
    return
  fi

  while true; do
    if ! printf 'Auth (username:password): ' > /dev/tty; then
      die "Cannot write to terminal while reading Auth. Set PING_MONITOR_AUTH before running non-interactively."
    fi

    if ! read -r value < /dev/tty; then
      die "Cannot read Auth. Set PING_MONITOR_AUTH before running non-interactively."
    fi
    if [[ "${value}" == *:* && ! "${value}" == ":"* && ! "${value}" == *":" ]]; then
      echo "${value}"
      return
    fi
    echo "Auth must be in username:password format" >&2
  done
}

detect_platform() {
  local os
  os="$(uname -s)"

  case "${os}" in
    Darwin)
      echo "macos"
      ;;
    Linux)
      echo "linux"
      ;;
    *)
      echo "unsupported"
      ;;
  esac
}

detect_arch() {
  local arch
  arch="$(uname -m)"

  case "${arch}" in
    x86_64|amd64)
      echo "x64"
      ;;
    aarch64|arm64)
      echo "arm64"
      ;;
    *)
      echo "unsupported"
      ;;
  esac
}

download_binary() {
  local platform=$1
  local arch=$2
  local asset_name
  local url

  asset_name="${ASSET_PREFIX}-${platform}-${arch}"
  url="https://github.com/${REPO}/releases/latest/download/${asset_name}"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "${TMP_BIN}" "${url}"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -q -O "${TMP_BIN}" "${url}"
    return
  fi

  die "curl or wget is required to download binary"
}

write_env_file() {
  local server=$1
  local auth=$2

  mkdir -p "${CONFIG_DIR}"
  cat <<EOF >"${ENV_FILE}"
PING_MONITOR_SERVER=${server}
PING_MONITOR_AUTH=${auth}
PING_MONITOR_BINARY_PATH=${BIN_PATH}
EOF
  chmod 600 "${ENV_FILE}"
}

write_runner() {
  mkdir -p "${INSTALL_DIR}"

  cat <<'EOF' >"${RUNNER_PATH}"
#!/usr/bin/env sh
set -eu

if [ -z "${PING_MONITOR_SERVER:-}" ] || [ -z "${PING_MONITOR_AUTH:-}" ]; then
  echo "Missing PING_MONITOR_SERVER or PING_MONITOR_AUTH" >&2
  exit 1
fi

if [ -z "${PING_MONITOR_BINARY_PATH:-}" ]; then
  echo "Missing PING_MONITOR_BINARY_PATH" >&2
  exit 1
fi

exec "${PING_MONITOR_BINARY_PATH}" \
  --server "${PING_MONITOR_SERVER}" \
  --auth "${PING_MONITOR_AUTH}"
EOF

  chmod 755 "${RUNNER_PATH}"
}

install_linux() {
  local service_dir
  local service_path
  local timer_path

  service_dir="${HOME}/.config/systemd/user"
  service_path="${service_dir}/ping-monitor.service"
  timer_path="${service_dir}/ping-monitor.timer"

  mkdir -p "${service_dir}"

  # Replace any previous installation (service/timer from older versions).
  systemctl --user disable --now ping-monitor.service ping-monitor.timer 2>/dev/null || true
  systemctl --user stop ping-monitor.service ping-monitor.timer 2>/dev/null || true

  cat <<EOF >"${service_path}"
[Unit]
Description=Ping Monitor Service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=${ENV_FILE}
ExecStart=${RUNNER_PATH}

[Install]
WantedBy=default.target
EOF

  cat <<EOF >"${timer_path}"
[Unit]
Description=Run ping-monitor every minute

[Timer]
OnCalendar=*-*-* *:*:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now ping-monitor.timer
}

escape_xml() {
  local input=$1

  printf '%s' "${input}" |
    sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&apos;/g'
}

install_macos() {
  local agent_dir
  local plist_path
  local server_escaped
  local auth_escaped

  local server=$1
  local auth=$2

  agent_dir="${HOME}/Library/LaunchAgents"
  plist_path="${agent_dir}/com.juniyadi.ping-monitor.plist"

  mkdir -p "${agent_dir}"
  mkdir -p "${HOME}/Library/Logs"

  server_escaped=$(escape_xml "${server}")
  auth_escaped=$(escape_xml "${auth}")

  cat <<EOF >"${plist_path}"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.juniyadi.ping-monitor</string>

    <key>ProgramArguments</key>
    <array>
      <string>${RUNNER_PATH}</string>
    </array>

    <key>StartInterval</key>
    <integer>60</integer>

    <key>EnvironmentVariables</key>
    <dict>
      <key>PING_MONITOR_SERVER</key>
      <string>${server_escaped}</string>
      <key>PING_MONITOR_AUTH</key>
      <string>${auth_escaped}</string>
      <key>PING_MONITOR_BINARY_PATH</key>
      <string>${BIN_PATH}</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/ping-monitor.out.log</string>

    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/ping-monitor.err.log</string>
  </dict>
</plist>
EOF

  launchctl bootout gui/"$(id -u)" "${plist_path}" 2>/dev/null || true
  launchctl bootstrap gui/"$(id -u)" "${plist_path}"
  launchctl enable gui/"$(id -u)"/com.juniyadi.ping-monitor
}

main() {
  local platform
  local arch
  local server
  local auth
  local arg

  platform=$(detect_platform)
  arch=$(detect_arch)

  [[ "${platform}" == "unsupported" ]] && die "Unsupported OS. Only Linux and macOS are supported"
  [[ "${arch}" == "unsupported" ]] && die "Unsupported architecture. Only x64 and arm64 are supported"

  while [[ $# -gt 0 ]]; do
    arg=$1

    case "${arg}" in
      --server)
        shift
        [[ $# -lt 1 ]] && die "--server requires a value"
        server=$1
        shift
        ;;
      --auth)
        shift
        [[ $# -lt 1 ]] && die "--auth requires a value"
        auth=$1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: ${arg}"
        ;;
    esac
  done

  server=${server:-${PING_MONITOR_SERVER:-}}
  auth=${auth:-${PING_MONITOR_AUTH:-}}

  if [[ -z "${server}" ]]; then
    server=$(prompt_value "Server: " "Server")
  fi

  if [[ -z "${auth}" ]]; then
    auth=$(prompt_auth)
  fi

  require_value "${server}" "Server"
  require_value "${auth}" "Auth"

  echo "Detected ${platform}/${arch}. Downloading latest binary..."
  download_binary "${platform}" "${arch}"

  mkdir -p "${INSTALL_DIR}"
  mv "${TMP_BIN}" "${BIN_PATH}"
  chmod 755 "${BIN_PATH}"

  write_env_file "${server}" "${auth}"
  write_runner

  if [[ "${platform}" == "linux" ]]; then
    install_linux
  else
    install_macos "${server}" "${auth}"
  fi

  echo "Installed ping-monitor"
  echo "Binary: ${BIN_PATH}"
  echo "Service installed"
}

main "$@"
