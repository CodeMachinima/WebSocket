const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const root = __dirname;
const server = http.createServer((req, res) => {
  const requested = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(root, requested);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    const types = { '.html': 'text/html; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css', '.js': 'text/javascript' };
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type': type}); res.end(data);
  });
});
const wss = new WebSocket.Server({ server });
const rooms = new Map();
wss.on('connection', (client, req) => {
  const room = new URL(req.url, 'http://localhost').searchParams.get('room') || 'MOSES1';
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(client);
  client.on('message', message => {
    let payload;
    try { payload = JSON.parse(message.toString()); } catch { return; }

    // Use the server as a shared clock so devices with different system times
    // can still schedule audio for the same instant.
    if (payload.type === 'clock-sync') {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'clock-sync-response', id: payload.id, serverTime: Date.now() }));
      }
      return;
    }

    const outgoing = JSON.stringify(payload.type === 'transport'
      ? { ...payload, serverTime: Date.now() }
      : payload);
    for (const peer of rooms.get(room)) {
      if (peer !== client && peer.readyState === WebSocket.OPEN) peer.send(outgoing);
    }
  });
  client.on('close', () => { rooms.get(room)?.delete(client); if (!rooms.get(room)?.size) rooms.delete(room); });
});
server.listen(8080, () => console.log('Shadow Moses split signal at http://localhost:8080'));
