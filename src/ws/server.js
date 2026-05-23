import {WebSocket, WebSocketServer} from 'ws';
import {wsArcjet} from "../arcjet.js";


const matchSubscribers = new Map();

function subscribe(matchId, socket) {
    if(!matchSubscribers.has(matchId)) {
        matchSubscribers.set(matchId, new Set());
    }

    matchSubscribers.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
    const subscribers = matchSubscribers.get(matchId);

    if(!subscribers) return;

    subscribers.delete(socket);

    if(subscribers.size === 0) {
        matchSubscribers.delete(matchId);
    }
}

function cleanupSubscriptions(socket) {
    for(const matchId of socket.subscriptions) {
        unsubscribe(matchId, socket);
    }
}

function sendJson(socket, payload) {
    if(socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify(payload));
}

function broadcastToAll(wss, payload) {
    for (const client of wss.clients)  {
        if(client.readyState !== WebSocket.OPEN) continue;

        client.send(JSON.stringify(payload));
    }
}


function broadcastToMatch(matchId, payload) {
    const subscribers = matchSubscribers.get(matchId);
    if(!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify(payload);

    for(const client of subscribers) {
        if(client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

function handleMessage(socket, data) {
    let message;

    try {
        message = JSON.parse(data.toString());
    } catch {
        sendJson(socket, { type: 'error', message: 'Invalid JSON' });
        return; // ← also add this return
    }

    const matchId = Number(message?.matchId);  // convert to number

    if(message?.type === "subscribe" && Number.isInteger(matchId)) {  // ← use matchId not message.matchId
        subscribe(matchId, socket);
        socket.subscriptions.add(matchId);
        sendJson(socket, { type: 'subscribed', matchId });
        return;
    }

    if(message?.type === "unsubscribe" && Number.isInteger(matchId)) {  // ← same here
        unsubscribe(matchId, socket);
        socket.subscriptions.delete(matchId);
        sendJson(socket, { type: 'unsubscribed', matchId });
    }
}


export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

    wss.on('connection', async (socket, req) => {
        socket.isAlive = true;
        socket.subscriptions = new Set();
        let ready = false;
        const queue = [];

        socket.on('pong', () => { socket.isAlive = true; });
        socket.on('message', (data) => {
            if (!ready) { queue.push(data); return; }
            handleMessage(socket, data);
        });
        socket.on('close', () => cleanupSubscriptions(socket));
        socket.on('error', () => socket.terminate());

        if (wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req, {
                    fingerprint: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1'
                });
                if (decision.isDenied()) {
                    const code = decision.reason.isRateLimit() ? 1013 : 1008;
                    const reason = decision.reason.isRateLimit() ? 'Rate limit exceeded' : 'Access denied';
                    socket.close(code, reason);
                    return;
                }
            } catch (e) {
                console.error('WS connection error', e);
                socket.close(1011, 'Server security error');
                return;
            }
        }

        ready = true;
        sendJson(socket, { type: 'welcome' });

        for (const data of queue) handleMessage(socket, data);
        queue.length = 0;
    });

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();

            ws.isAlive = false;
            ws.ping();
        })}, 30000);

    wss.on('close', () => clearInterval(interval));

    function broadcastMatchCreated(match) {
        broadcastToAll(wss, { type: 'match_created', data: match });
    }

    function broadcastCommentaryAdded(matchId, comment) {
        broadcastToMatch(matchId, { type: 'commentary_added', matchId, data: comment });
    }

    return { broadcastMatchCreated, broadcastCommentaryAdded };
}