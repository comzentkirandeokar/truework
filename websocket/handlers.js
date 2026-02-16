const { subscribe, unsubscribeFromTopic, unsubscribeAll, publish } = require('./topics');
const { saveUserLocation, getNearbyUsers, getTwoUsersLocations } = require('../helpers/userLocation');

let clients = {}; // { userId: ws }
let activeTraces = {}; // { 'userA_userB': { ws, users: [A,B], threshold } }

// Haversine formula for accurate distance in km
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // distance in km
}

// Broadcast latest location to all other clients
async function broadcastLocation(userId, lat, lng) {
    for (let id in clients) {
        if (clients[id] && id !== userId) {
            clients[id].send(JSON.stringify({
                type: "location",
                userId,
                latitude: lat,
                longitude: lng
            }));
        }
    }

    // Update any active traces involving this user
    for (const key in activeTraces) {
        const trace = activeTraces[key];
        if (trace.users.includes(userId)) {
            sendTraceUpdate(trace);
        }
    }
}

// Send latest locations and distance to trace WS
async function sendTraceUpdate(trace) {
    const [userA, userB] = trace.users;
    const { userALocation, userBLocation } = await getTwoUsersLocations(userA, userB);

    if (!userALocation || !userBLocation) return;

    const distance = getDistance(
        userALocation.latitude, userALocation.longitude,
        userBLocation.latitude, userBLocation.longitude
    );

    trace.ws.send(JSON.stringify({
        type: "trace_locations",
        users: [
            { userId: userA, ...userALocation, is_it_you: true  },
            { userId: userB, ...userBLocation, is_it_you: false }
        ],
        distance
    }));

    // Stop trace if within threshold
    if (distance <= trace.threshold) {
        delete activeTraces[`${userA}_${userB}`];
    }
}

// Start a trace between two users
function startTrace(ws, userA, userB, threshold = 0.05) {
    const key = `${userA}_${userB}`;
    activeTraces[key] = { ws, users: [userA, userB], threshold };
    sendTraceUpdate(activeTraces[key]);
}

// Handle incoming WebSocket messages
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

        if (data.type === "location" && data.userId && data.lat != null && data.lng != null) {
            saveUserLocation(data.userId, data.lat, data.lng);
            publish(`user-${data.userId}`, { type: "location", ...data });
            broadcastLocation(data.userId, data.lat, data.lng);
        }

        if (data.type === "nearby" && data.lat != null && data.lng != null) {
            getNearbyUsers(data.lat, data.lng, data.distance, data.category, data.userId)
                .then(users => ws.send(JSON.stringify({ type: "nearby", users })));
        }

        if (data.type === "trace" && data.userId && data.nextUser) {
            startTrace(ws, data.userId, data.nextUser, data.threshold || 0.05);
        }

    } catch (err) {
        console.error("Error handling message:", err);
    }
}

// Handle client disconnect
function handleDisconnect(ws) {
    unsubscribeAll(ws);

    for (let userId in clients) {
        if (clients[userId] === ws) {
            delete clients[userId];
            console.log(`User disconnected: ${userId}`);

            // Remove traces involving this user
            for (const key in activeTraces) {
                const trace = activeTraces[key];
                if (trace.users.includes(userId)) {
                    delete activeTraces[key];
                }
            }
            break;
        }
    }
}

module.exports = { handleMessage, handleDisconnect, clients };
