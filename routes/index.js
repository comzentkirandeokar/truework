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

// Emit realtime event to user
router.post('/api/realtime/emit', (req, res) => {
    console.log('📩 Received realtime emit request:', req.body);
    
    const { userId, event, data } = req.body;
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-KEY'];
    
    // Validate API key
    const validApiKey = process.env.WEBSOCKET_API_KEY || 'your-secret-key';
    if (apiKey !== validApiKey) {
        console.log('❌ Invalid API key');
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
