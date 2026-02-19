const { subscribe, unsubscribeFromTopic, unsubscribeAll, publish } = require('./topics');
const { saveUserLocation, getNearbyUsers, getTwoUsersLocations } = require('../helpers/userLocation');

let clients = {};
let activeTraces = {};

// --------------------
// Distance Calculator
// --------------------
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --------------------
// Trace Key Helper
// --------------------
function getTraceKey(userA, userB) {
    return [userA, userB].sort().join("_");
}

// --------------------
// 🔥 Notify Nearby Users (Full List)
// --------------------
async function notifyNearbyUsers(changedUserId) {
    try {
        const { userALocation } = await getTwoUsersLocations(changedUserId, changedUserId);
        if (!userALocation) return;

        const { latitude, longitude } = userALocation;

        // Get users near the changed user
        const nearbyUsers = await getNearbyUsers(
            latitude,
            longitude,
            5, // distance in km
            null,
            changedUserId
        );

        for (const user of nearbyUsers) {
            const client = clients[user.userId];
            if (!client) continue;

            // Recalculate THEIR nearby list
            const { userALocation: otherLocation } =
                await getTwoUsersLocations(user.userId, user.userId);
            if (!otherLocation) continue;

            const updatedNearby = await getNearbyUsers(
                otherLocation.latitude,
                otherLocation.longitude,
                5,
                null,
                user.userId
            );

            const registeredNearbyUsers =
                updatedNearby.filter(u => clients[u.userId]);

            client.send(JSON.stringify({
                type: "nearby",
                users: registeredNearbyUsers
            }));
        }

    } catch (err) {
        console.error("notifyNearbyUsers error:", err);
    }
}

// --------------------
// Broadcast Location
// --------------------
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

    for (const key in activeTraces) {
        const trace = activeTraces[key];
        if (trace.users.includes(userId)) {
            sendTraceUpdate(trace);
        }
    }
}

// --------------------
// Send Trace Update
// --------------------
async function sendTraceUpdate(trace) {
    const [userA, userB] = trace.users;

    const { userALocation, userBLocation } = await getTwoUsersLocations(userA, userB);

    const userAOnline = !!clients[userA];
    const userBOnline = !!clients[userB];

    if (!userAOnline && !userBOnline) {
        delete activeTraces[getTraceKey(userA, userB)];
        return;
    }

    try {
        if (!userAOnline || !userBOnline) {
            const onlineUser = userAOnline ? userA : userB;
            const onlineLocation = userAOnline ? userALocation : userBLocation;
            if (!onlineLocation) return;

            trace.ws.send(JSON.stringify({
                type: "trace_locations",
                users: [{ userId: onlineUser, ...onlineLocation }],
                distance: null,
                status: "single_user"
            }));
            return;
        }

        if (!userALocation || !userBLocation) return;

        const distance = getDistance(
            userALocation.latitude, userALocation.longitude,
            userBLocation.latitude, userBLocation.longitude
        );

        trace.ws.send(JSON.stringify({
            type: "trace_locations",
            users: [
                { userId: userA, ...userALocation, is_it_you: true },
                { userId: userB, ...userBLocation, is_it_you: false }
            ],
            distance: distance.toFixed(2),
            status: "both_online"
        }));

        if (distance <= trace.threshold) {
            delete activeTraces[getTraceKey(userA, userB)];
        }

    } catch (e) {
        console.error("sendTraceUpdate error:", e);
    }
}

// --------------------
// Start Trace
// --------------------
function startTrace(ws, userA, userB, threshold = 0.05) {
    if (!clients[userA] && !clients[userB]) {
        ws.send(JSON.stringify({
            type: "error",
            message: "Both users must be registered to start trace"
        }));
        return;
    }

    const key = getTraceKey(userA, userB);
    if (activeTraces[key]) return;

    activeTraces[key] = { ws, users: [userA, userB], threshold };
    sendTraceUpdate(activeTraces[key]);
}

// --------------------
// Unregister User
// --------------------
function unregisterUser(ws, userId) {
    if (!clients[userId] || clients[userId] !== ws) {
        ws.send(JSON.stringify({
            type: "error",
            message: "User not registered or invalid session"
        }));
        return;
    }

    // 🔥 Notify nearby users BEFORE deletion
    notifyNearbyUsers(userId);

    delete clients[userId];

    for (const key in activeTraces) {
        const trace = activeTraces[key];
        if (trace.users.includes(userId)) {
            try {
                trace.ws.send(JSON.stringify({
                    type: "trace_update",
                    message: `${userId} went offline`
                }));
            } catch (e) {}
        }
    }

    unsubscribeAll(ws);

    ws.send(JSON.stringify({
        type: "unregistered",
        userId
    }));

    console.log(`User unregistered: ${userId}`);
}

// --------------------
// Handle Messages
// --------------------
function handleMessage(ws, message) {
    try {
        const data = JSON.parse(message);

        // REGISTER
        if (data.type === "register" && data.userId) {
            if (clients[data.userId]) {
                unregisterUser(clients[data.userId], data.userId);
            }

            clients[data.userId] = ws;

            ws.send(JSON.stringify({
                type: "registered",
                userId: data.userId
            }));

            console.log(`User registered: ${data.userId}`);

            // 🔥 Notify nearby users
            notifyNearbyUsers(data.userId);
        }

        // SUBSCRIBE
        if (data.type === "subscribe" && data.topic) {
            subscribe(ws, data.topic);
            ws.send(JSON.stringify({ type: "subscribed", topic: data.topic }));
        }

        // UNSUBSCRIBE
        if (data.type === "unsubscribe" && data.topic) {
            unsubscribeFromTopic(ws, data.topic);
            ws.send(JSON.stringify({ type: "unsubscribed", topic: data.topic }));
        }

        // LOCATION UPDATE
        if (data.type === "location" && data.userId && data.lat != null && data.lng != null) {
            saveUserLocation(data.userId, data.lat, data.lng);
            publish(`user-${data.userId}`, { type: "location", ...data });
            broadcastLocation(data.userId, data.lat, data.lng);

            // 🔥 Notify nearby users on movement
            notifyNearbyUsers(data.userId);
        }

        // NEARBY
        if (data.type === "nearby" && data.lat != null && data.lng != null) {
            getNearbyUsers(data.lat, data.lng, data.distance, data.category, data.userId)
                .then(users => {
                    const registeredNearbyUsers = users.filter(user => clients[user.userId]);
                    ws.send(JSON.stringify({
                        type: "nearby",
                        users: registeredNearbyUsers
                    }));
                });
        }

        // TRACE
        if (data.type === "trace" && data.userId && data.nextUser) {
            startTrace(ws, data.userId, data.nextUser, data.threshold ?? 0.05);
        }

        // UNREGISTER
        if (data.type === "unregister" && data.userId) {
            unregisterUser(ws, data.userId);
        }

    } catch (err) {
        console.error("Error handling message:", err);
    }
}

// --------------------
// Handle Disconnect
// --------------------
function handleDisconnect(ws) {
    unsubscribeAll(ws);

    for (let userId in clients) {
        if (clients[userId] === ws) {

            // 🔥 Notify nearby users BEFORE deletion
            notifyNearbyUsers(userId);

            delete clients[userId];

            console.log(`User disconnected: ${userId}`);
            break;
        }
    }
}

module.exports = { handleMessage, handleDisconnect, clients };
