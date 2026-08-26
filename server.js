require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');

const { initWebSocket } = require('./websocket');
const routes = require('./routes');

const app = express();


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());


// ============================================================
// ROUTES
// ============================================================

app.use('/', routes);


// ============================================================
// HTTP + WEBSOCKET SERVER
// ============================================================

const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

initWebSocket(server);


// ============================================================
// START SERVER
// ============================================================

server.listen(
    PORT,
    () => console.log(
        `Server listening on port ${PORT}`
    )
);
