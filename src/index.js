import express from 'express';
import {matchRouter} from "./routes/matches.js";
import  http from "http";
import {attachWebSocketServer} from "./ws/server.js";

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

const server = http.createServer(app);

app.use(express.json());

app.get('/', (_req, res) => {
    res.send('Sportz server is running.');
});

app.use('/matches',matchRouter);

const {broadcastMatchCreated} = attachWebSocketServer(server);

app.locals.broadcastMatchCreated = broadcastMatchCreated;

 server.listen(PORT,HOST, () => {
    const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

    console.log(`Server running on ${baseUrl}`);
    console.log(`Websocket server running on ${baseUrl.replace('http', 'ws')}/ws`);
});
