const { subscribe, unsubscribeFromTopic, unsubscribeAll, publish } = require('./topics');
const { saveUserLocation, getNearbyUsers } = require('../helpers/userLocation');

let clients = {}; // { userId: ws }

function handleMessage(ws, message) {
    try {
        const data = JSON.parse(message);

        if (data.type === "register" && data.userId) {
            clients[data.userId] = ws;
            ws.send(JSON.stringify({ type: "registered", userId: data.userId }));
            console.log(`User registered: ${data.userId}`);
        }

        if (data.type === "subscribe" && data.topic) {
            subscribe(ws, data.topic);
            ws.send(JSON.stringify({ type: "subscribed", topic: data.topic }));
        }

        if (data.type === "unsubscribe" && data.topic) {
            unsubscribeFromTopic(ws, data.topic);
            ws.send(JSON.stringify({ type: "unsubscribed", topic: data.topic }));
        }

        if (data.type === "location" && data.userId && data.lat && data.lng) {
            saveUserLocation(data.userId, data.lat, data.lng);
            publish(`user-${data.userId}`, { type: "location", ...data });
        }

        if (data.type === "nearby" && data.lat && data.lng) {
            getNearbyUsers(data.lat, data.lng, data.distance, data.category, data.userId)
                .then(users => ws.send(JSON.stringify({ type: "nearby", users })));
        }
    } catch (err) {
        console.error("Error handling message:", err);
    }
}

function handleDisconnect(ws) {
    unsubscribeAll(ws);
    for (let userId in clients) {
        if (clients[userId] === ws) {
            delete clients[userId];
            console.log(`User disconnected: ${userId}`);
            break;
        }
    }
}

module.exports = { handleMessage, handleDisconnect, clients };
