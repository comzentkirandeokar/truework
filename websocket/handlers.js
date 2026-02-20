const { subscribe, unsubscribeFromTopic, unsubscribeAll, publish } = require('./topics');
const { saveUserLocation, getNearbyUsers, getTwoUsersLocations } = require('../helpers/userLocation');

let clients = {};
let activeTraces = {};
let nearbyWatchers = {}; // Track users who requested nearby

// --------------------
// Distance Calculator
// --------------------
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat/2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --------------------
// Update Only Nearby Watchers
// --------------------
async function updateNearbyWatchers() {
    for (let watcherId in nearbyWatchers) {

        const watcherConfig = nearbyWatchers[watcherId];
        const ws = clients[watcherId];

        if (!ws) continue;

        try {
            const users = await getNearbyUsers(
                watcherConfig.lat,
                watcherConfig.lng,
                watcherConfig.distance,
                watcherConfig.category,
                watcherId
            );

            const registeredNearbyUsers =
                users.filter(user => clients[user.userId]);

            ws.send(JSON.stringify({
                type: "nearby",
                users: registeredNearbyUsers
            }));

        } catch (e) {
            console.error("Nearby update error:", e);
        }
    }
}

// --------------------
// Trace Key Helper
// --------------------
function getTraceKey(userA, userB) {
    return [userA, userB].sort().join("_");
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

    // Update active traces
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

    const { userALocation, userBLocation } =
        await getTwoUsersLocations(userA, userB);

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
                type: "trace",
                users: [{ userId: onlineUser, ...onlineLocation }],
                distance: null,
                status: "single_user"
            }));

            return;
        }

        if (!userALocation || !userBLocation) return;

        const distance = getDistance(
            userALocation.latitude,
            userALocation.longitude,
            userBLocation.latitude,
            userBLocation.longitude
        );

        trace.ws.send(JSON.stringify({
            type: "trace",
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

    } catch (e) {}
}

// --------------------
// Start Trace
// --------------------
function startTrace(ws, userA, userB, threshold = 0.05) {
    if (!clients[userA] && !clients[userB]) {
        ws.send(JSON.stringify({
            type: "error",
            message: "Both users must be registered"
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
            message: "Invalid session"
        }));
        return;
    }

    delete clients[userId];
    delete nearbyWatchers[userId]; // Cleanup watcher

    unsubscribeAll(ws);

    ws.send(JSON.stringify({
        type: "unregistered",
        userId
    }));

    console.log(`User unregistered: ${userId}`);

    updateNearbyWatchers();
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

            updateNearbyWatchers();
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

            updateNearbyWatchers();
        }

        // NEARBY REQUEST
        if (data.type === "nearby" && data.lat != null && data.lng != null) {

            // Save watcher config
            nearbyWatchers[data.userId] = {
                lat: data.lat,
                lng: data.lng,
                distance: data.distance ?? 5,
                category: data.category ?? null
            };

            getNearbyUsers(
                data.lat,
                data.lng,
                data.distance,
                data.category,
                data.userId
            ).then(users => {

                const registeredNearbyUsers =
                    users.filter(user => clients[user.userId]);

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
            delete clients[userId];
            delete nearbyWatchers[userId];
            console.log(`User disconnected: ${userId}`);
            updateNearbyWatchers();
            break;
        }
    }
}

module.exports = { handleMessage, handleDisconnect, clients };