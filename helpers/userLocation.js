const pool = require('../config/db');

// Save or update the latest location
async function saveUserLocation(userId, lat, lng) {
    try {
        const [result] = await pool.execute(
            `UPDATE locations SET latitude = ?, longitude = ?, created_at = NOW() WHERE user_id = ?`,
            [lat, lng, userId]
        );

        if (result.affectedRows === 0) {
            await pool.execute(
                `INSERT INTO locations (user_id, latitude, longitude, created_at) VALUES (?, ?, ?, NOW())`,
                [userId, lat, lng]
            );
        }
        console.log(`Location saved for user ${userId}`);
    } catch (err) {
        console.error("MySQL Error:", err);
    }
}

// Get latest location for a single user
async function getUserLatestLocation(userId) {
    try {
        const [rows] = await pool.execute(
            `SELECT m.member_fname AS name, c.category_name,l.latitude, l.longitude, l.created_at
                    
             FROM locations l
             INNER JOIN member_master m ON l.user_id = m.member_id
             INNER JOIN member_categories c ON m.category = c.category_id
             WHERE l.user_id = ?
             ORDER BY l.created_at DESC
             LIMIT 1`,
            [userId]
        );
        return rows[0] || null;
    } catch (err) {
        console.error("Error fetching latest location:", err);
        return null;
    }
}

// Get latest locations of two users
async function getTwoUsersLocations(userAId, userBId) {
    const userALocation = await getUserLatestLocation(userAId);
    const userBLocation = await getUserLatestLocation(userBId);
    return { userALocation, userBLocation };
}

// Nearby users query
async function getNearbyUsers(lat, lng, radiusKm = 5, category = null, excludeUserId = null) {
    try {
        let query = `
            SELECT l.user_id, l.latitude, l.longitude, m.member_fname, m.category, category_name,
            (6371 * ACOS(
                COS(RADIANS(?)) * COS(RADIANS(l.latitude)) * COS(RADIANS(l.longitude) - RADIANS(?)) +
                SIN(RADIANS(?)) * SIN(RADIANS(l.latitude))
            )) AS distance
            FROM locations l
            INNER JOIN member_master m ON l.user_id = m.member_id
            INNER JOIN member_categories c ON c.category_id = m.category
            WHERE member_user_type='2'
        `;
        let params = [lat, lng, lat];

        if (excludeUserId) { query += " AND l.user_id != ?"; params.push(excludeUserId); }
        if (category) { query += " AND m.category = ?"; params.push(category); }

        query += " HAVING distance <= ? + 0.01 ORDER BY distance ASC";
        params.push(radiusKm);

        const [rows] = await pool.execute(query, params);
        return rows.map(u => ({
            userId: u.user_id,
            name: u.member_fname,
            category: u.category,
            categoryName: u.category_name,
            latitude: u.latitude,
            longitude: u.longitude,
            distance: parseFloat(u.distance.toFixed(2))
        }));
    } catch (err) {
        console.error("Nearby query error:", err);
        return [];
    }
}

module.exports = { saveUserLocation, getNearbyUsers, getUserLatestLocation, getTwoUsersLocations };
