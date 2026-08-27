require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mysql = require('mysql2/promise'); // <-- Add this

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8001;

// Database connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'truework',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

let clients = {};
let driverLocations = {};

// ============================================================
// ROUTES
// ============================================================
app.post('/api/realtime/emit', (req, res) => {
    const { userId, event, data } = req.body;
    const apiKey = req.headers['x-api-key'];

    const validApiKey = (process.env.WEBSOCKET_API_KEY || 'your-secret-key').trim();
    const providedKey = (apiKey || '').trim();

    if (providedKey !== validApiKey) {
        return res.status(401).json({
            success: false,
            message: 'Invalid API key'
        });
    }

    const userIdStr = String(userId);
    if (userId && clients[userIdStr]) {
        try {
            clients[userIdStr].send(JSON.stringify({
                event: event || 'TEST_EVENT',
                data: data || {}
            }));

            return res.json({
                success: true,
                delivered: true,
                userId: userIdStr,
                event: event || 'TEST_EVENT',
                message: 'Realtime event sent successfully'
            });
        } catch (err) {
            return res.json({
                success: false,
                delivered: false,
                userId: userIdStr,
                event: event || 'TEST_EVENT',
                message: 'Error sending: ' + err.message
            });
        }
    } else {
        return res.json({
            success: true,
            delivered: false,
            userId: userIdStr,
            event: event || 'TEST_EVENT',
            message: 'User is not connected'
        });
    }
});

app.get('/api/realtime/health', (req, res) => {
    res.json({
        status: 'ok',
        connected_clients: Object.keys(clients).length,
        clients: Object.keys(clients)
    });
});

// ============================================================
// TEST DATABASE CONNECTION
// ============================================================
app.get('/api/realtime/db-test', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1 + 1 AS result');
        res.json({
            success: true,
            message: 'Database connected!',
            result: rows[0].result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        method: req.method,
        url: req.url
    });
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Received:', data);

            // ============================================================
            // 1. REGISTER USER
            // ============================================================
            if (data.type === "register") {
                const userId = String(data.userId);
                clients[userId] = ws;

                ws.send(JSON.stringify({
                    event: 'REGISTERED',
                    userId: userId,
                    message: 'Successfully registered'
                }));

                ws.send(JSON.stringify({
                    type: "allDrivers",
                    locations: driverLocations
                }));
            }

            // ============================================================
            // 2. NEARBY WORKERS
            // ============================================================
            if (data.type === "nearby") {
                const { lat, lng, userId, category, distance = 15 } = data;

                console.log(`📍 Nearby request: lat=${lat}, lng=${lng}, category=${category}`);

                try {
                    let sql = `
                        SELECT 
                            u.id AS userId,
                            u.name,
                            u.lat AS latitude,
                            u.lng AS longitude,
                            u.profile_photo,
                            u.rating,
                            u.category_id,
                            ROUND(
                                (6371 * acos(
                                    cos(radians(?)) * cos(radians(u.lat)) * 
                                    cos(radians(u.lng) - radians(?)) + 
                                    sin(radians(?)) * sin(radians(u.lat))
                                )), 2
                            ) AS distance
                        FROM users u
                        WHERE u.user_type = 'WORKER'
                          AND u.is_online = 1
                          AND u.lat IS NOT NULL 
                          AND u.lat != 0.0
                    `;

                    const params = [lat, lng, lat];

                    if (category && category !== 0) {
                        sql += ` AND u.category_id = ?`;
                        params.push(category);
                    }

                    sql += `
                        HAVING distance <= ?
                        GROUP BY u.id
                        ORDER BY distance ASC
                        LIMIT 50
                    `;
                    params.push(distance);

                    const [rows] = await pool.query(sql, params);

                    console.log(`✅ Found ${rows.length} nearby workers`);

                    ws.send(JSON.stringify({
                        type: "nearby",
                        users: rows
                    }));

                } catch (dbError) {
                    console.error('❌ Database error:', dbError);
                    ws.send(JSON.stringify({
                        type: "nearby",
                        users: [],
                        error: "Database error"
                    }));
                }
            }

            // ============================================================
            // 3. LOCATION UPDATE
            // ============================================================
            if (data.type === "location") {
                const { driverId, lat, lng } = data;
                driverLocations[driverId] = { lat, lng, timestamp: Date.now() };

                try {
                    await pool.query(
                        'UPDATE users SET lat = ?, lng = ?, last_location_update = NOW() WHERE id = ?',
                        [lat, lng, driverId]
                    );
                } catch (updateError) {
                    // Silent fail
                }

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

        } catch (err) {
            console.error("❌ Error:", err);
            ws.send(JSON.stringify({
                type: "error",
                message: "Invalid request format"
            }));
        }
    });

    ws.on('close', () => {
        for (let userId in clients) {
            if (clients[userId] === ws) {
                delete clients[userId];
                break;
            }
        }
    });
});

// ============================================================
// START SERVER
// ============================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
