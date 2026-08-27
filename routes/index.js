// routes/index.js
const express = require('express');
const router = express.Router();

// Test route to check if routes are working
router.get('/test', (req, res) => {
    res.json({ message: 'Routes are working!' });
});

// ============================================================
// REALTIME ROUTES
// ============================================================

// Health check endpoint
router.get('/api/realtime/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Realtime API is working',
        timestamp: new Date().toISOString()
    });
});

// Temporary debug endpoint — shows the length + first/last 2 chars
// of the key Node has actually loaded from the environment, without
// exposing the full secret. Remove once the key mismatch is confirmed fixed.
router.get('/api/realtime/debug-key', (req, res) => {
    const key = (process.env.WEBSOCKET_API_KEY || 'your-secret-key').trim();
    res.json({
        length: key.length,
        first2: key.slice(0, 2),
        last2: key.slice(-2)
    });
});

// Emit realtime event to user
router.post('/api/realtime/emit', (req, res) => {
    console.log('📩 Received realtime emit request:', req.body);

    const { userId, event, data } = req.body;
    const apiKey = req.headers['x-api-key'];

    // Validate API key (trimmed on both sides to avoid whitespace mismatches)
    const validApiKey = (process.env.WEBSOCKET_API_KEY || 'your-secret-key').trim();
    const providedKey = (apiKey || '').trim();

    if (providedKey !== validApiKey) {
        console.log('❌ Invalid API key');
        console.log(`   received length=${providedKey.length}, expected length=${validApiKey.length}`);
        return res.status(401).json({
            success: false,
            message: 'Invalid API key'
        });
    }

    // Get connected clients from websocket module
    const { getClients } = require('../websocket');
    const clients = getClients();
    const userIdStr = String(userId);

    // Check if user is connected
    if (userId && clients[userIdStr]) {
        try {
            const payload = {
                event: event || 'TEST_EVENT',
                data: data || {}
            };

            clients[userIdStr].send(JSON.stringify(payload));

            console.log(`✅ Sent ${event} to user ${userIdStr}`);
            return res.json({
                success: true,
                delivered: true,
                userId: userIdStr,
                event: event || 'TEST_EVENT',
                message: 'Realtime event sent successfully'
            });
        } catch (err) {
            console.error('❌ Error sending to user:', err);
            return res.json({
                success: false,
                delivered: false,
                userId: userIdStr,
                event: event || 'TEST_EVENT',
                message: 'Error sending: ' + err.message
            });
        }
    } else {
        console.log(`❌ User ${userIdStr} is not connected`);
        console.log(`📋 Connected clients: ${Object.keys(clients)}`);
        return res.json({
            success: true,
            delivered: false,
            userId: userIdStr,
            event: event || 'TEST_EVENT',
            message: 'User is not connected'
        });
    }
});

module.exports = router;
