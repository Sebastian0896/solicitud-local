const db = require('../../config/database');

const getProviderHistory = async (req, res) => {
  const providerId = req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await db.query(
      `SELECT
         r.id,
         r.request_text,
         r.status,
         r.created_at,
         r.completed_at,
         r.total_price,
         r.image_url,
         c.name AS category_name,
         c.icon AS category_icon,
         u.name AS customer_name
       FROM requests r
       LEFT JOIN categories c ON r.category_id = c.id
       LEFT JOIN users u ON r.customer_id = u.id
       WHERE r.provider_id = $1
         AND r.is_deleted = false
         AND r.status IN ('delivered', 'cancelled')
       ORDER BY COALESCE(r.completed_at, r.created_at) DESC
       LIMIT $2 OFFSET $3`,
      [providerId, limit, offset]
    );

    const total = await db.query(
      `SELECT COUNT(*) FROM requests
       WHERE provider_id = $1 AND is_deleted = false AND status IN ('delivered', 'cancelled')`,
      [providerId]
    );

    res.json({
      requests: result.rows,
      total: parseInt(total.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    console.error('getProviderHistory error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = getProviderHistory;
