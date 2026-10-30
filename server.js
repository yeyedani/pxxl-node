const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const port = process.env.PORT || 3000;
const WS_PATH = process.env.WS_PATH || '/vless-pxxl';
const TMP = '/tmp/pxxl-node';
fs.mkdirSync(TMP, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, { headers: { 'User-Agent': 'pxxl-node/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`download ${res.statusCode} ${u}`));
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    get(url);
  });
}

function start(name, cmd, args) {
  try {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => console.log(`[${name}] ${String(d).slice(0, 500)}`));
    p.stderr.on('data', d => console.log(`[${name}] ${String(d).slice(0, 500)}`));
    p.on('exit', (c) => console.log(`${name} exited ${c}`));
    console.log(`${name} started`);
    return p;
  } catch (e) { console.log(`${name} start failed: ${e.message}`); return null; }
}

// Each component starts independently: one failure must NOT kill the others.
// No GitHub API anywhere (Pxxl shared egress gets rate-limited); all downloads are direct pinned URLs.
async function startNezha() {
  try {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const nz = path.join(TMP, 'nezha-agent');
    if (!fs.existsSync(nz)) {
      console.log('downloading nezha-agent');
      const zipPath = path.join(TMP, 'agent.zip');
      await download(`https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${arch}.zip`, zipPath);
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntries().find(e => e.entryName.endsWith('nezha-agent'));
      if (!entry) throw new Error('nezha-agent not in zip');
      fs.writeFileSync(nz, entry.getData());
      fs.chmodSync(nz, 0o755);
      fs.unlinkSync(zipPath);
    }
    const cfg = path.join(TMP, 'config.yml');
    fs.writeFileSync(cfg, `client_secret: ${process.env.NZ_CLIENT_SECRET}\ndebug: false\ndisable_auto_update: false\ndisable_command_execute: false\ndisable_force_update: false\ndisable_nat: false\ndisable_send_query: false\ngpu: false\ninsecure_tls: false\nip_report_period: 1800\nreport_delay: 3\nself_update_period: 0\nserver: ${process.env.NZ_SERVER}\nskip_connection_count: false\nskip_procs_count: false\ntemperature: false\ntls: ${process.env.NZ_TLS || 'true'}\nuse_atomgit_to_upgrade: false\nuse_gitee_to_upgrade: false\nuse_ipv6_country_code: false\nuuid: ${process.env.NZ_UUID}\n`);
    start('nezha', nz, ['-c', cfg]);
  } catch (e) { console.log(`nezha failed (others continue): ${e.message}`); }
}

async function startSingBox() {
  try {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const sb = path.join(TMP, 'sing-box');
    if (!fs.existsSync(sb)) {
      console.log('downloading sing-box pinned v1.14.4');
      const tarPath = path.join(TMP, 'sb.tar.gz');
      await download(`https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-linux-${arch}.tar.gz`, tarPath);
      const tar = require('tar');
      await tar.x({ file: tarPath, cwd: TMP, strip: 1, filter: (p) => p.endsWith('/sing-box') });
      fs.chmodSync(sb, 0o755);
      fs.unlinkSync(tarPath);
    }
    const cfg = path.join(TMP, 'sing-box.json');
    fs.writeFileSync(cfg, JSON.stringify({
      log: { level: 'info' },
      inbounds: [{ type: 'vless', tag: 'vless-in', listen: '127.0.0.1', listen_port: 8001, users: [{ uuid: process.env.NODE_UUID, flow: '' }], transport: { type: 'ws', path: WS_PATH } }],
      outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'block', tag: 'block' }]
    }));
    start('sing-box', sb, ['run', '-c', cfg]);
  } catch (e) { console.log(`sing-box failed (others continue): ${e.message}`); }
}

async function startCloudflared() {
  try {
    if (!process.env.ARGO_AUTH) return;
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const cf = path.join(TMP, 'cloudflared');
    if (!fs.existsSync(cf)) {
      console.log('downloading cloudflared');
      await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`, cf);
      fs.chmodSync(cf, 0o755);
    }
    start('cloudflared', cf, ['tunnel', '--no-autoupdate', 'run', '--token', process.env.ARGO_AUTH]);
  } catch (e) { console.log(`cloudflared failed (others continue): ${e.message}`); }
}

// Run all three in parallel, independently.
startNezha();
startSingBox();
startCloudflared();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', app: 'pxxl-node', time: new Date().toISOString()}));
    return;
  }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Pxxl Node</title></head><body><h1>Pxxl 节点容器运行中</h1><p>节点可走 Pxxl 自带域名 + WS 路径，也可走 Argo 隧道；Nezha agent 随容器启动。</p><p><a href="/health">健康检查 /health</a></p></body></html>`);
});

// Bypass Argo: WS upgrade on the Pxxl public domain itself proxies to local sing-box.
// Client: wss://pxxl-node-v.pxxlspace.cv/vless-pxxl  (no cloudflared needed for this path)
server.on('upgrade', (req, socket, head) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath !== WS_PATH) { socket.destroy(); return; }
  const upstream = net.connect(8001, '127.0.0.1', () => {
    upstream.write(`GET ${WS_PATH} HTTP/1.1\r\nHost: 127.0.0.1:8001\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${req.headers['sec-websocket-key'] || ''}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    // sing-box will reply 101; after that, pipe raw bytes both ways
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(port, () => console.log(`listening on ${port}`));
