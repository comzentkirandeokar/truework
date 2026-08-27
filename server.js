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
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests for debugging
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.url}`);
    next();
});

// ============================================================
// ROUTES - Make sure this is BEFORE the 404 handler
// ============================================================

app.use('/', routes);

// ============================================================
// 404 Handler - For debugging
// ============================================================
app.use((req, res) => {
    console.log(`❌ 404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Not Found',
        method: req.method,
        url: req.url,
        message: `Cannot ${req.method} ${req.url}`
    });
});

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
    () => console.log(`🚀 Server listening on port ${PORT}`)
);
