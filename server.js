const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const WebSocket = require('ws');

const root = __dirname;
const server = http.createServer((req, res) => {
  const requested = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(root, requested);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    const types = { '.html': 'text/html; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type': type}); res.end(data);
  });
});
const wss = new WebSocket.Server({ server });
const rooms = new Map();
wss.on('connection', (client, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const room = params.get('room') || 'MOSES1';
  const role = params.get('role') === 'sender' ? 'sender' : 'receiver';
  const stem = params.get('stem') || 'backingVocal';
  const singleReceiverStems = new Set(['guitar', 'bass', 'drums', 'piano']);
  if (!rooms.has(room)) rooms.set(room, { clients: new Set(), sender: null, receivers: new Map() });
  const roomState = rooms.get(room);

  if (role === 'sender' && roomState.sender) {
    client.close(1008, 'A sender is already connected to this session');
    return;
  }
  if (role === 'receiver' && singleReceiverStems.has(stem) && roomState.receivers.has(stem)) {
    client.close(1008, `The ${stem} receiver is already connected to this session`);
    return;
  }

  client.role = role;
  client.stem = stem;
  client.id = randomUUID();
  client.rotation = 0;
  roomState.clients.add(client);
  if (role === 'sender') roomState.sender = client;
  else if (singleReceiverStems.has(stem)) roomState.receivers.set(stem, client);
  broadcastParticipants(roomState);

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

    if (payload.type === 'level') {
      if (client.role !== 'receiver') return;
      const value = Math.max(0, Math.min(1, Number(payload.value) || 0));
      const frequencies = Array.isArray(payload.frequencies)
        ? payload.frequencies.slice(0, 96).map(sample => Math.max(0, Math.min(255, Number(sample) || 0)))
        : [];
      const outgoing = JSON.stringify({ type: 'level', clientId: client.id, stem: client.stem, value, frequencies });
      for (const peer of roomState.clients) {
        if (peer !== client && peer.readyState === WebSocket.OPEN) peer.send(outgoing);
      }
      return;
    }

    if (payload.type === 'rotation') {
      if (client.role !== 'receiver') return;
      const rotation = Math.max(-1000000, Math.min(1000000, Number(payload.rotation) || 0));
      client.rotation = rotation;
      const outgoing = JSON.stringify({ type: 'rotation', clientId: client.id, stem: client.stem, rotation });
      for (const peer of roomState.clients) {
        if (peer !== client && peer.readyState === WebSocket.OPEN) peer.send(outgoing);
      }
      return;
    }

    if (payload.type === 'transport' && client.role !== 'sender') return;

    const outgoing = JSON.stringify(payload.type === 'transport'
      ? { ...payload, serverTime: Date.now() }
      : payload);
    for (const peer of roomState.clients) {
      if (peer !== client && peer.readyState === WebSocket.OPEN) peer.send(outgoing);
    }
  });
  client.on('close', () => {
    roomState.clients.delete(client);
    if (roomState.sender === client) roomState.sender = null;
    if (roomState.receivers.get(stem) === client) roomState.receivers.delete(stem);
    broadcastParticipants(roomState);
    if (!roomState.clients.size) rooms.delete(room);
  });
});

function broadcastParticipants(roomState) {
  const participants = [...roomState.clients].map(client => ({ id: client.id, role: client.role, stem: client.stem, rotation: client.rotation || 0 }));
  const message = JSON.stringify({ type: 'participants', participants });
  for (const client of roomState.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
server.listen(8080, () => console.log('Shadow Moses split signal at http://localhost:8080'));
