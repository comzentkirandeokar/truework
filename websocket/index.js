// websocket/index.js

const WebSocket = require('ws');

// Store connected clients
let clients = {};
let driverLocations = {};

const initWebSocket = (server) => {
    const wss = new WebSocket.Server({ 
        server,
        path: '/ws' // or whatever path you use
    });

    console.log('✅ WebSocket server initialized');

    wss.on('connection', (ws, req) => {
        console.log('🔌 New WebSocket connection');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('📩 Received WebSocket message:', data);

                // Register user
                if (data.type === "register") {
                    const userId = String(data.userId);
                    clients[userId] = ws;
                    console.log(`✅ User registered: ${userId}`);
                    console.log(`📋 All clients: ${Object.keys(clients)}`);

                    // Send acknowledgment
                    ws.send(JSON.stringify({
                        event: 'REGISTERED',
                        userId: userId,
                        message: 'Successfully registered'
                    }));

                    // Send current driver locations
                    ws.send(JSON.stringify({
                        type: "allDrivers",
                        locations: driverLocations
                    }));
                }

                // Receive driver location update
                if (data.type === "location") {
                    const { driverId, lat, lng } = data;
                    driverLocations[driverId] = { lat, lng, timestamp: Date.now() };

                    // Broadcast to all clients
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: "location",
                                driverId,
                                lat,
                                lng
                            }));
                        }
                    });

                    console.log(`📍 Driver ${driverId} location updated: ${lat}, ${lng}`);
                }

            } catch (err) {
                console.error("❌ Error parsing message:", err);
            }
        });

        ws.on('close', () => {
            // Remove disconnected client
            for (let userId in clients) {
                if (clients[userId] === ws) {
                    delete clients[userId];
                    console.log(`❌ User disconnected: ${userId}`);
                    console.log(`📋 Remaining clients: ${Object.keys(clients)}`);
                    break;
                }
            }
        });

        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
        });
    });

    return wss;
};

// Get connected clients
const getClients = () => clients;

// Get driver locations
const getDriverLocations = () => driverLocations;

module.exports = {
    initWebSocket,
    getClients,
    getDriverLocations
};
