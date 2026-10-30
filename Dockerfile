FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip tar && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Nezha agent v2 (official release) + cloudflared (official release). sing-box is fetched at runtime (latest linux tarball) so the build does not pin a versioned filename.
RUN ARCH=$(uname -m) && case "$ARCH" in x86_64) A=amd64 ;; aarch64) A=arm64 ;; *) echo "unsupported arch $ARCH" && exit 1 ;; esac \
  && curl -sL "https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${A}.zip" -o /tmp/agent.zip \
  && unzip -o /tmp/agent.zip -d /app && chmod +x /app/nezha-agent && rm -f /tmp/agent.zip \
  && curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${A}" -o /app/cloudflared \
  && chmod +x /app/cloudflared
COPY package.json server.js entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]
