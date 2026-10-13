// Proxy local só para o E2E neste container: o apiv2 do firebase-tools manda
// toda requisição (inclusive para o emulador em 127.0.0.1) pelo HTTPS_PROXY e
// ignora NO_PROXY. Este proxy aplica o NO_PROXY: loopback vai direto; todo o
// resto é encadeado, sem alteração, ao proxy do agente (UPSTREAM_PORT).
const http = require('node:http');
const net = require('node:net');

const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT);
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 34800);

const isLoopback = (host) => /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/i.test(host);

const splitHostPort = (authority) => {
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(authority);
  return m ? { host: m[1], port: Number(m[2]) } : { host: authority, port: 443 };
};

const server = http.createServer((req, res) => {
  let target;
  try { target = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
  if (!isLoopback(target.hostname)) {
    // HTTP simples para fora não é servido pelo proxy do agente; recusa.
    res.writeHead(403); res.end('loopback-proxy: apenas HTTP para loopback');
    return;
  }
  const headers = { ...req.headers };
  delete headers['proxy-connection'];
  delete headers['proxy-authorization'];
  const upstream = http.request({
    host: target.hostname, port: target.port || 80, method: req.method,
    path: target.pathname + target.search, headers,
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  upstream.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); });
  req.pipe(upstream);
});

server.on('connect', (req, client, head) => {
  const { host, port } = splitHostPort(req.url);
  if (isLoopback(host)) {
    const direct = net.connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) direct.write(head);
      direct.pipe(client); client.pipe(direct);
    });
    direct.on('error', () => client.destroy());
    client.on('error', () => direct.destroy());
    return;
  }
  // Encadeia ao proxy do agente repassando o CONNECT original.
  const up = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const lines = [`CONNECT ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) up.write(head);
    up.pipe(client); client.pipe(up);
  });
  up.on('error', () => client.destroy());
  client.on('error', () => up.destroy());
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`loopback-proxy em 127.0.0.1:${LISTEN_PORT} -> upstream ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
