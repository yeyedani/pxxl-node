#!/bin/sh
# Pxxl node package: Nezha agent + sing-box VLESS/WS + cloudflared Argo tunnel.
# All secrets come only from environment variables, never baked into files.
# Required env: NZ_SERVER, NZ_CLIENT_SECRET, NZ_UUID (new, unique per agent)
#               NODE_UUID (VLESS uuid, may differ from NZ_UUID), ARGO_DOMAIN, ARGO_AUTH
# Optional env: WS_PATH (default /vless-pxxl), PORT (platform sets this)
set -e
WS_PATH="${WS_PATH:-/vless-pxxl}"

# Nezha agent v2
if [ -n "$NZ_SERVER" ] && [ -n "$NZ_CLIENT_SECRET" ] && [ -n "$NZ_UUID" ]; then
  cat > /app/config.yml <<EOF
client_secret: ${NZ_CLIENT_SECRET}
debug: false
disable_auto_update: false
disable_command_execute: false
disable_force_update: false
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: false
ip_report_period: 1800
report_delay: 3
self_update_period: 0
server: ${NZ_SERVER}
skip_connection_count: false
skip_procs_count: false
temperature: false
tls: ${NZ_TLS:-true}
use_atomgit_to_upgrade: false
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${NZ_UUID}
EOF
  /app/nezha-agent -c /app/config.yml &
  echo "nezha-agent started"
fi

# sing-box (fetch latest at runtime if not present)
if [ ! -x /app/sing-box ]; then
  ARCH=$(uname -m) && case "$ARCH" in x86_64) A=amd64 ;; aarch64) A=arm64 ;; *) echo "unsupported arch" && exit 1 ;; esac
  SB_URL=$(curl -s https://api.github.com/repos/SagerNet/sing-box/releases/latest | grep browser_download_url | grep "linux-${A}.tar.gz" | head -1 | cut -d '"' -f 4)
  curl -sL "$SB_URL" -o /tmp/sb.tar.gz && tar -xzf /tmp/sb.tar.gz -C /tmp && cp /tmp/sing-box-*/sing-box /app/sing-box && chmod +x /app/sing-box && rm -f /tmp/sb.tar.gz
fi

if [ -n "$NODE_UUID" ]; then
  cat > /app/sing-box.json <<EOF
{
  "log": {"level": "info"},
  "inbounds": [{
    "type": "vless", "tag": "vless-in",
    "listen": "127.0.0.1", "listen_port": 8001,
    "users": [{"uuid": "${NODE_UUID}", "flow": ""}],
    "transport": {"type": "ws", "path": "${WS_PATH}"}
  }],
  "outbounds": [{"type": "direct", "tag": "direct"}, {"type": "block", "tag": "block"}]
}
EOF
  /app/sing-box run -c /app/sing-box.json &
  echo "sing-box started on 127.0.0.1:8001 ws ${WS_PATH}"
fi

# cloudflared Argo tunnel -> sing-box (TLS terminated by Cloudflare, sing-box stays plain WS)
if [ -n "$ARGO_AUTH" ]; then
  /app/cloudflared tunnel --no-autoupdate run --token "$ARGO_AUTH" &
  echo "cloudflared tunnel started"
fi

exec node /app/server.js
