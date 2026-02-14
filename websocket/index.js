const WebSocket = require('ws');
const { handleMessage, handleDisconnect } = require('./handlers');

function initWebSocket(server) {
    const wss = new WebSocket.Server({ server }, () => {
        console.log("WebSocket server running");
    });

    wss.on('connection', ws => {
        ws.on('message', message => handleMessage(ws, message));
        ws.on('close', () => handleDisconnect(ws));
    });
}

module.exports = { initWebSocket };
