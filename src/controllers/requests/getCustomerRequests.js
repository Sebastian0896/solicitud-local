const db = require('../../config/database');
// Cliente obtiene sus pedidos

const getCustomerRequests = async (req, res) => {
  const customerId = req.user.id;
  
  try {
    const result = await db.query(
      `SELECT id, request_text, status, provider_name, created_at, assigned_at, completed_at
       FROM requests 
       WHERE customer_id = $1 
       ORDER BY created_at DESC`,
      [customerId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get customer requests error:', error);
    res.status(500).json({ error: error.message });
  }
};


module.exports = getCustomerRequests;