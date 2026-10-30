const http = require('http');
const port = process.env.PORT || 3000;
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
