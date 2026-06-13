const db = require('../../config/database');

const getCustomerRequests = async (req, res) => {
  const customerId = req.user.id;

  try {
    const result = await db.query(
      `SELECT
        r.id,
        r.request_text,
        r.status,
        r.customer_name,
        r.customer_phone,
        r.provider_id,
        r.provider_name,
        r.created_at,
        r.assigned_at,
        r.completed_at,
        r.total_price,
        r.repeat_count,
        r.last_repeated_at,
        r.original_created_at,
        c.id   AS category_id,
        c.name AS category_name,
        c.icon AS category_icon,
        ST_Y(r.customer_location::geometry) AS lat,
        ST_X(r.customer_location::geometry) AS lng,
        ST_Y(u.current_location::geometry) AS provider_lat,
        ST_X(u.current_location::geometry) AS provider_lng,
        u.business_name                    AS provider_business_name,
        EXISTS(SELECT 1 FROM ratings WHERE request_id = r.id) AS rated_by_customer
       FROM requests r
       LEFT JOIN categories c ON r.category_id = c.id
       LEFT JOIN users u ON r.provider_id = u.id
       WHERE r.customer_id = $1
         AND r.is_deleted = false
       ORDER BY
         CASE
           WHEN r.status IN ('pending', 'waiting_confirmation', 'assigned', 'on_the_way') THEN 0
           ELSE 1
         END,
         r.last_repeated_at DESC NULLS LAST,
         r.created_at DESC`,
      [customerId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get customer requests error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = getCustomerRequests;
