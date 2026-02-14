require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');

// Express app
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Track connected clients
let clients = {};

// Helper: save or update driver location
async function saveDriverLocation(driverId, lat, lng) {
    try {
        const [result] = await pool.execute(
            `UPDATE locations 
             SET latitude = ?, longitude = ?, created_at = NOW() 
             WHERE user_id = ?`,
            [lat, lng, driverId]
        );

        if (result.affectedRows === 0) {
            await pool.execute(
                `INSERT INTO locations (user_id, latitude, longitude, created_at) 
                 VALUES (?, ?, ?, NOW())`,
                [driverId, lat, lng]
            );
        }

        console.log(`Location saved for driver ${driverId}`);
    } catch (dbError) {
        console.error("MySQL Error:", dbError);
    }
}

// Helper: get nearby users
async function getNearbyUsers(lat, lng, radiusKm = 5, category = null, excludeUserId = null) {
    try {
        let query = `
            SELECT l.user_id, l.latitude, l.longitude, m.member_fname, m.category,
                (6371 * ACOS(
                    COS(RADIANS(?)) 
                    * COS(RADIANS(l.latitude)) 
                    * COS(RADIANS(l.longitude) - RADIANS(?)) 
                    + SIN(RADIANS(?)) * SIN(RADIANS(l.latitude))
                )) AS distance
            FROM locations l
            INNER JOIN member_master m ON l.user_id = m.member_id
            WHERE 1=1
        `;
        let params = [lat, lng, lat];

        if (excludeUserId) {
            query += " AND l.user_id != ?";
            params.push(excludeUserId);
        }

        if (category) {
            query += " AND m.category = ?";
            params.push(category);
        }

        query += " HAVING distance <= ? ORDER BY distance ASC";
        params.push(radiusKm);

        const [rows] = await pool.execute(query, params);
        return rows.map(u => ({
            userId: u.user_id,
            name: u.member_fname,
            category: u.category,
            latitude: u.latitude,
            longitude: u.longitude,
            distance: parseFloat(u.distance.toFixed(2))
        }));

    } catch (err) {
        console.error("Nearby query error:", err);
        return [];
    }
}

// Attach WebSocket to HTTP server
const wss = new WebSocket.Server({ server }, () => {
    console.log("WebSocket server running on port " + PORT);
});

// WebSocket connection handling
wss.on('connection', ws => {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "register") {
                clients[data.userId] = ws;
                console.log(`User registered: ${data.userId}`);
                ws.send(JSON.stringify({ type: "registered", userId: data.userId }));
            }

            if (data.type === "location") {
                const { driverId, lat, lng } = data;
                if (!driverId || !lat || !lng) return;

                await saveDriverLocation(driverId, lat, lng);

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
            }

            if (data.type === "nearby") {
                const { lat, lng, category, userId, distance } = data;
                if (!lat || !lng) return;

                const nearbyUsers = await getNearbyUsers(lat, lng, distance, category, userId);
                ws.send(JSON.stringify({ type: "nearby", users: nearbyUsers }));
            }

        } catch (err) {
            console.error("Error handling message:", err);
        }
    });

    ws.on('close', () => {
        for (let userId in clients) {
            if (clients[userId] === ws) {
                delete clients[userId];
                console.log(`User disconnected: ${userId}`);
                break;
            }
        }
    });
});

// Optional: basic route to test server
app.get('/', (req, res) => res.send('WebSocket server is running!'));

// Start server
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
