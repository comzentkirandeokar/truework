const express = require('express');
const router = express.Router();

// Import your controllers
const { emitRealtimeEvent, healthCheck } = require('../controllers/realtimeController');

// ============================================================
// REALTIME ROUTES
// ============================================================

// Health check endpoint
router.get('/api/realtime/health', healthCheck);

// Emit realtime event to user
router.post('/api/realtime/emit', emitRealtimeEvent);

// ============================================================
// EXISTING ROUTES
// ============================================================
router.get('/', (req, res) => {

res.send('WebSocket server with topic-based updates is running!');

});

module.exports = router;
