require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { initWebSocket } = require('./websocket');
const routes = require('./routes');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], credentials: true }));
app.use('/', routes);

const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

initWebSocket(server); // Start WebSocket server

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
