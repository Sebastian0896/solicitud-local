const db = require('../../config/database');
// Cliente obtiene sus pedidos

const getCustomerRequests = async (req, res) => {
  const customerId = req.user.id;
  
  try {
    const result = await db.query(
      `SELECT 
        id, 
        request_text, 
        status, 
        customer_name,
        customer_phone,
        provider_name, 
        created_at, 
        assigned_at, 
        completed_at,
        total_price,
        repeat_count,
        last_repeated_at,
        original_created_at
       FROM requests 
       WHERE customer_id = $1 
         AND is_deleted = false
       ORDER BY 
         CASE 
           WHEN status IN ('pending', 'waiting_confirmation', 'assigned') THEN 0
           ELSE 1
         END,
         last_repeated_at DESC NULLS LAST,
         created_at DESC`,
      [customerId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get customer requests error:', error);
    res.status(500).json({ error: error.message });
  }
};


module.exports = getCustomerRequests;