const express = require('express');

const router = express.Router();

const {
    emitToUser
} = require('../websocket/handlers');


// ============================================================
// HEALTH CHECK
// ============================================================

router.get('/', (req, res) => {

    res.send('WebSocket server with topic-based updates is running!');

});


// ============================================================
// CI4 → NODE → WEBSOCKET
// ============================================================

router.post('/api/realtime/emit', (req, res) => {

    try {

        // ------------------------------------------------------
        // Validate API Key
        // ------------------------------------------------------

        const apiKey = req.headers['x-api-key'];

        if (
            !process.env.WEBSOCKET_API_KEY ||
            apiKey !== process.env.WEBSOCKET_API_KEY
        ) {

            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });

        }


        // ------------------------------------------------------
        // Get Request Data
        // ------------------------------------------------------

        const {
            userId,
            event,
            data = {}
        } = req.body;


        // ------------------------------------------------------
        // Validate Required Fields
        // ------------------------------------------------------

        if (!userId) {

            return res.status(400).json({
                success: false,
                message: 'userId is required'
            });

        }

        if (!event) {

            return res.status(400).json({
                success: false,
                message: 'event is required'
            });

        }


        // ------------------------------------------------------
        // Send Event To Connected User
        // ------------------------------------------------------

        const result = emitToUser(
            userId,
            event,
            data
        );


        // ------------------------------------------------------
        // User Not Connected
        // ------------------------------------------------------

        if (!result.success) {

            return res.status(200).json({
                success: true,
                delivered: false,
                message: result.message
            });

        }


        // ------------------------------------------------------
        // Successfully Sent
        // ------------------------------------------------------

        return res.status(200).json({
            success: true,
            delivered: true,
            userId: String(userId),
            event
        });

    } catch (error) {

        console.error(
            'Realtime emit error:',
            error
        );

        return res.status(500).json({
            success: false,
            message: 'Failed to send realtime event'
        });

    }

});


module.exports = router;
