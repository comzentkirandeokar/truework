require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');

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
    const { userId, event, data, broadcast } = req.body;
    const apiKey = req.headers['x-api-key'];

    const validApiKey = (process.env.WEBSOCKET_API_KEY || 'your-secret-key').trim();
    const providedKey = (apiKey || '').trim();

    if (providedKey !== validApiKey) {
        return res.status(401).json({
            success: false,
            message: 'Invalid API key'
        });
    }

    // Broadcast to all connected clients
    if (broadcast) {
        let sentCount = 0;
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    event: event || 'TEST_EVENT',
                    data: data || {}
                }));
                sentCount++;
            }
        });
        return res.json({
            success: true,
            broadcast: true,
            sent_count: sentCount,
            event: event || 'TEST_EVENT',
            message: 'Broadcast event sent successfully'
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

// ============================================================
// DEBUG: SHOW DATABASE TABLES AND STRUCTURE
// ============================================================
app.get('/api/realtime/db-tables', async (req, res) => {
    try {
        const [tables] = await pool.query('SHOW TABLES');
        
        let usersStructure = null;
        try {
            const [structure] = await pool.query('DESCRIBE users');
            usersStructure = structure;
        } catch (e) {
            usersStructure = { error: 'users table does not exist' };
        }
        
        let memberStructure = null;
        try {
            const [structure] = await pool.query('DESCRIBE member_master');
            memberStructure = structure;
        } catch (e) {
            memberStructure = { error: 'member_master table does not exist' };
        }
        
        let workersStructure = null;
        try {
            const [structure] = await pool.query('DESCRIBE workers');
            workersStructure = structure;
        } catch (e) {
            workersStructure = { error: 'workers table does not exist' };
        }
        
        res.json({
            success: true,
            tables: tables.map(t => Object.values(t)[0]),
            users_structure: usersStructure,
            member_master_structure: memberStructure,
            workers_structure: workersStructure
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Database query failed',
            error: error.message
        });
    }
});

// ============================================================
// DEBUG: CHECK WORKER DATA
// ============================================================
app.get('/api/realtime/check-worker', async (req, res) => {
    try {
        const tables = ['users', 'member_master', 'workers'];
        let result = { success: true, tables_checked: [], workers_found: [] };

        for (const table of tables) {
            try {
                const [rows] = await pool.query(`SHOW TABLES LIKE "${table}"`);
                if (rows.length > 0) {
                    let workerQuery = '';
                    if (table === 'member_master') {
                        workerQuery = `SELECT member_id AS id, member_fname AS name, member_user_type, member_status, lat, lng FROM ${table} WHERE member_user_type = 2`;
                    } else {
                        workerQuery = `SELECT id, name, user_type, is_online, lat, lng FROM ${table} WHERE user_type = 'WORKER' OR role = 'WORKER'`;
                    }
                    const [workers] = await pool.query(workerQuery + ' LIMIT 5');
                    if (workers.length > 0) {
                        result.workers_found.push({
                            table: table,
                            count: workers.length,
                            sample: workers
                        });
                    }
                }
                result.tables_checked.push(table);
            } catch (e) {
                // Silently skip
            }
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Query failed',
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

            // 1. REGISTER USER
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
            // 2. NEARBY WORKERS - Using locations table (FIXED)
            // ============================================================
            if (data.type === "nearby") {
                const { lat, lng, userId, category, distance = 15 } = data;

                console.log(`📍 Nearby request: lat=${lat}, lng=${lng}, category=${category}`);

                try {
                    let sql = `
                        SELECT 
                            u.member_id AS userId,
                            CONCAT(u.member_fname, ' ', u.member_lastname) AS name,
                            l.latitude AS latitude,
                            l.longitude AS longitude,
                            u.member_mobileno AS phone,
                            u.member_emailid AS email,
                            u.category AS category_id,
                            ROUND(
                                (6371 * acos(
                                    cos(radians(?)) * cos(radians(l.latitude)) * 
                                    cos(radians(l.longitude) - radians(?)) + 
                                    sin(radians(?)) * sin(radians(l.latitude))
                                )), 2
                            ) AS distance
                        FROM member_master u
                        INNER JOIN locations l ON u.member_id = l.user_id
                        WHERE u.member_user_type = 2
                          AND u.member_status = 1
                          AND u.member_approval_status = 1
                          AND l.latitude IS NOT NULL 
                          AND l.latitude != 0.0
                    `;

                    const params = [lat, lng, lat];

                    if (category && category !== 0) {
                        sql += ` AND u.category = ?`;
                        params.push(category);
                    }

                    sql += `
                        GROUP BY u.member_id
                        HAVING distance <= ?
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
                        error: "Database error: " + dbError.message
                    }));
                }
            }

            // ============================================================
            // 3. LOCATION UPDATE (Flutter Live GPS Stream)
            // ============================================================
            if (data.type === "location") {
                const driverId = String(data.userId || data.driverId);
                const { lat, lng, booking_id, heading = 0.0, speed = 0.0 } = data;
                driverLocations[driverId] = { lat, lng, heading, speed, timestamp: Date.now() };

                try {
                    // Update or insert into locations table
                    const [existing] = await pool.query(
                        'SELECT id FROM locations WHERE user_id = ?',
                        [driverId]
                    );

                    if (existing.length > 0) {
                        await pool.query(
                            'UPDATE locations SET latitude = ?, longitude = ?, created_at = NOW() WHERE user_id = ?',
                            [lat, lng, driverId]
                        );
                    } else {
                        await pool.query(
                            'INSERT INTO locations (user_id, latitude, longitude, created_at) VALUES (?, ?, ?, NOW())',
                            [driverId, lat, lng]
                        );
                    }
                } catch (updateError) {
                    console.error('❌ Location update error:', updateError);
                }

                // If booking_id is provided, relay WORKER_LOCATION_UPDATE to active Customer socket
                if (booking_id) {
                    try {
                        const [bookings] = await pool.query(
                            'SELECT customer_id FROM bookings WHERE booking_id = ?',
                            [booking_id]
                        );
                        if (bookings.length > 0) {
                            const customerId = String(bookings[0].customer_id);
                            if (clients[customerId]) {
                                clients[customerId].send(JSON.stringify({
                                    event: 'WORKER_LOCATION_UPDATE',
                                    data: {
                                        booking_id: Number(booking_id),
                                        worker_id: Number(driverId),
                                        lat: Number(lat),
                                        lng: Number(lng),
                                        heading: Number(heading),
                                        speed: Number(speed),
                                        timestamp: new Date().toISOString()
                                    }
                                }));
                            }
                        }
                    } catch (bErr) {
                        console.error('❌ Booking customer relay error:', bErr);
                    }
                }

                // Broadcast location frame to listening map clients
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: "location",
                            driverId,
                            userId: driverId,
                            lat,
                            lng,
                            heading,
                            speed
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
