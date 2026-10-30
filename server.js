const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execSync } = require('child_process');

const port = process.env.PORT || 3000;
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

async function ensureBinaries() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  // cloudflared: direct binary
  const cf = path.join(TMP, 'cloudflared');
  if (!fs.existsSync(cf) && process.env.ARGO_AUTH) {
    console.log('downloading cloudflared');
    await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`, cf);
    fs.chmodSync(cf, 0o755);
  }
  // nezha-agent: zip, extract only the binary via adm-zip
  const nz = path.join(TMP, 'nezha-agent');
  if (!fs.existsSync(nz) && process.env.NZ_SERVER && process.env.NZ_CLIENT_SECRET && process.env.NZ_UUID) {
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
  // sing-box: tar.gz, extract ONLY the binary (avoid libcronet.so disk blow-up)
  const sb = path.join(TMP, 'sing-box');
  if (!fs.existsSync(sb) && process.env.NODE_UUID) {
    console.log('downloading sing-box');
    const api = await new Promise((res, rej) => {
      https.get('https://api.github.com/repos/SagerNet/sing-box/releases/latest', { headers: { 'User-Agent': 'pxxl-node/1.0' } }, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
      }).on('error', rej);
    });
    const m = JSON.parse(api).assets.find(a => a.name.includes(`linux-${arch}.tar.gz`));
    if (!m) throw new Error('sing-box asset not found');
    const tarPath = path.join(TMP, 'sb.tar.gz');
    await download(m.browser_download_url, tarPath);
    const tar = require('tar');
    await tar.x({ file: tarPath, cwd: TMP, strip: 1, filter: (p) => p.endsWith('/sing-box') });
    fs.chmodSync(sb, 0o755);
    fs.unlinkSync(tarPath);
  }
  return { cf, nz, sb };
}

function start(name, cmd, args) {
  try {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => console.log(`[${name}] ${String(d).slice(0, 500)}`));
    p.stderr.on('data', d => console.log(`[${name}] ${String(d).slice(0, 500)}`));
    p.on('exit', (c) => console.log(`${name} exited ${c}`));
    console.log(`${name} started`);
  } catch (e) { console.log(`${name} start failed: ${e.message}`); }
}

async function boot() {
  try {
    const { cf, nz, sb } = await ensureBinaries();
    if (fs.existsSync(nz)) {
      const cfg = path.join(TMP, 'config.yml');
      fs.writeFileSync(cfg, `client_secret: ${process.env.NZ_CLIENT_SECRET}\ndebug: false\ndisable_auto_update: false\ndisable_command_execute: false\ndisable_force_update: false\ndisable_nat: false\ndisable_send_query: false\ngpu: false\ninsecure_tls: false\nip_report_period: 1800\nreport_delay: 3\nself_update_period: 0\nserver: ${process.env.NZ_SERVER}\nskip_connection_count: false\nskip_procs_count: false\ntemperature: false\ntls: ${process.env.NZ_TLS || 'true'}\nuse_atomgit_to_upgrade: false\nuse_gitee_to_upgrade: false\nuse_ipv6_country_code: false\nuuid: ${process.env.NZ_UUID}\n`);
      start('nezha', nz, ['-c', cfg]);
    }
    if (fs.existsSync(sb)) {
      const wsPath = process.env.WS_PATH || '/vless-pxxl';
      const cfg = path.join(TMP, 'sing-box.json');
      fs.writeFileSync(cfg, JSON.stringify({
        log: { level: 'info' },
        inbounds: [{ type: 'vless', tag: 'vless-in', listen: '127.0.0.1', listen_port: 8001, users: [{ uuid: process.env.NODE_UUID, flow: '' }], transport: { type: 'ws', path: wsPath } }],
        outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'block', tag: 'block' }]
      }));
      start('sing-box', sb, ['run', '-c', cfg]);
    }
    if (fs.existsSync(cf) && process.env.ARGO_AUTH) {
      start('cloudflared', cf, ['tunnel', '--no-autoupdate', 'run', '--token', process.env.ARGO_AUTH]);
    }
  } catch (e) { console.log(`boot error (app still serves health): ${e.message}`); }
}
boot();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', app: 'pxxl-node', time: new Date().toISOString()}));
    return;
  }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Pxxl Node</title></head><body><h1>Pxxl 节点容器运行中</h1><p>平台健康检查用根路径，节点走 Argo 隧道，Nezha agent 随容器启动。</p><p><a href="/health">健康检查 /health</a></p></body></html>`);
});
server.listen(port, () => console.log(`listening on ${port}`));
