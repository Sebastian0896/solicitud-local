const db = require('../../config/database');

const getCustomerHistory = async (req, res) => {
  const customerId = req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await db.query(
      `SELECT
         r.id,
         r.request_text,
         r.status,
         r.provider_name,
         r.created_at,
         r.completed_at,
         r.total_price,
         r.repeat_count,
         r.image_url,
         c.name AS category_name,
         c.icon AS category_icon,
         u.business_name AS provider_business_name,
         EXISTS(SELECT 1 FROM ratings WHERE request_id = r.id) AS rated_by_customer
       FROM requests r
       LEFT JOIN categories c ON r.category_id = c.id
       LEFT JOIN users u ON r.provider_id = u.id
       WHERE r.customer_id = $1
         AND r.is_deleted = false
         AND r.status IN ('delivered', 'cancelled')
       ORDER BY COALESCE(r.completed_at, r.created_at) DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset]
    );

    const total = await db.query(
      `SELECT COUNT(*) FROM requests
       WHERE customer_id = $1 AND is_deleted = false AND status IN ('delivered', 'cancelled')`,
      [customerId]
    );

    res.json({
      requests: result.rows,
      total: parseInt(total.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    console.error('getCustomerHistory error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = getCustomerHistory;
