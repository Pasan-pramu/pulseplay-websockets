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
    console.log('handleMessage received:', data.toString());
    let message;

    try {
        message = JSON.parse(data.toString());
    } catch {
        sendJson(socket, { type: 'error', message: 'Invalid JSON' });
    }

    const matchId = Number(message?.matchId);

    if(message?.type === "subscribe" && Number.isInteger(matchId)) {
        console.log('Subscribing socket to matchId:', matchId);
        subscribe(matchId, socket);
        socket.subscriptions.add(matchId);
        sendJson(socket, { type: 'subscribed', matchId });
        return;
    }

    if(message?.type === "unsubscribe" && Number.isInteger(matchId)) {
        unsubscribe(matchId, socket);
        socket.subscriptions.delete(matchId);
        sendJson(socket, { type: 'unsubscribed', matchId });
    }
}


export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

    wss.on('connection', async (socket, req) => {
        if(wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req, {
                    fingerprint: req.headers['x-forwarded-for'] ||
                        req.socket.remoteAddress ||
                        '127.0.0.1'
                });

                if(decision.isDenied()) {
                    const code = decision.reason.isRateLimit() ? 1013 : 1008;
                    const reason = decision.reason.isRateLimit() ? 'Rate limit exceeded' : 'Access denied';

                    socket.close(code, reason);
                    return;
                }
                console.log('Arcjet decision:', decision.conclusion);
            } catch (e) {
                console.error('WS connection error', e);
                socket.close(1011, 'Server security error');
                return;
            }
        }

        socket.isAlive = true;
        socket.on('pong', () => { socket.isAlive = true; });


        socket.subscriptions = new Set();

        sendJson(socket, { type: 'welcome' });

        socket.on('message', (data) => {
            handleMessage(socket, data);
        });

        socket.on('error', () => {
            socket.terminate();
        });

        socket.on('close', () => {
            cleanupSubscriptions(socket);
        })

        socket.on('error', console.error);
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