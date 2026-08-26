const express = require('express');

const router = express.Router();

const {
    emitToUser
} = require('../websocket/handlers');


// ============================================================
// HEALTH CHECK
// ============================================================

router.get('/', (req, res) => {

    res.status(200).json({
        success: true,
        message: 'WebSocket server with topic-based updates is running!'
    });

});


// ============================================================
// CI4 → NODE → WEBSOCKET
// ============================================================

router.post('/api/realtime/emit', (req, res) => {

    try {

        console.log('----------------------------------------');
        console.log('Realtime emit request received');
        console.log('Headers:', req.headers);
        console.log('Body:', req.body);


        // ====================================================
        // VALIDATE API KEY
        // ====================================================

        const apiKey = req.headers['x-api-key'];

        if (!process.env.WEBSOCKET_API_KEY) {

            console.error(
                'WEBSOCKET_API_KEY is not configured in Render'
            );

            return res.status(500).json({
                success: false,
                message: 'WEBSOCKET_API_KEY is not configured'
            });

        }


        if (!apiKey) {

            console.error(
                'X-API-KEY header is missing'
            );

            return res.status(401).json({
                success: false,
                message: 'X-API-KEY header is required'
            });

        }


        if (apiKey !== process.env.WEBSOCKET_API_KEY) {

            console.error(
                'Invalid X-API-KEY'
            );

            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });

        }


        console.log('API key validated successfully');


        // ====================================================
        // VALIDATE REQUEST BODY
        // ====================================================

        const {
            userId,
            event,
            data = {}
        } = req.body || {};


        if (
            userId === undefined ||
            userId === null ||
            userId === ''
        ) {

            return res.status(400).json({
                success: false,
                message: 'userId is required'
            });

        }


        if (
            !event ||
            typeof event !== 'string'
        ) {

            return res.status(400).json({
                success: false,
                message: 'event is required'
            });

        }


        // ====================================================
        // CHECK emitToUser FUNCTION
        // ====================================================

        if (typeof emitToUser !== 'function') {

            console.error(
                'emitToUser is not available. Check websocket/handlers.js export.'
            );

            return res.status(500).json({
                success: false,
                message: 'emitToUser function is not available'
            });

        }


        // ====================================================
        // SEND EVENT TO CONNECTED USER
        // ====================================================

        console.log(
            `Sending event "${event}" to user "${userId}"`
        );

        console.log(
            'Event data:',
            data
        );


        const result = emitToUser(
            userId,
            event,
            data
        );


        console.log(
            'emitToUser result:',
            result
        );


        // ====================================================
        // USER NOT CONNECTED
        // ====================================================

        if (!result || !result.success) {

            return res.status(200).json({
                success: true,
                delivered: false,
                userId: String(userId),
                event: event,
                message: result?.message || 'User is not connected'
            });

        }


        // ====================================================
        // SUCCESS
        // ====================================================

        console.log(
            `Realtime event "${event}" successfully sent to user ${userId}`
        );

        console.log('----------------------------------------');


        return res.status(200).json({
            success: true,
            delivered: true,
            userId: String(userId),
            event: event,
            message: 'Realtime event sent successfully'
        });


    } catch (error) {

        console.error(
            '========================================'
        );

        console.error(
            'Realtime emit error:'
        );

        console.error(
            error
        );

        console.error(
            'Error message:',
            error.message
        );

        console.error(
            'Error stack:',
            error.stack
        );

        console.error(
            '========================================'
        );


        // TEMPORARY:
        // Return actual error so we can debug from Postman.

        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to send realtime event',
            error: error.stack || null
        });

    }

});


module.exports = router;
