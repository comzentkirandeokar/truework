const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.send('WebSocket server with topic-based updates is running!');
});

module.exports = router;
