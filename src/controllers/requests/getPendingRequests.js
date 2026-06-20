const db = require('../../config/database');

// Obtener pedidos pendientes (SOLO de las categorías del proveedor) - MODIFICADO
const getPendingRequests = async (req, res) => {
  const providerId = req.user.id;
  
  try {
    // Obtener categorías del proveedor
    const catResult = await db.query(
      `SELECT category_id FROM provider_categories WHERE provider_id = $1`,
      [providerId]
    );
    
    const providerCategoryIds = catResult.rows.map(r => r.category_id);
    
    if (providerCategoryIds.length === 0) {
      return res.json([]); // Proveedor sin categorías no ve nada
    }
    
    // Obtener pedidos SOLO de sus categorías
    const result = await db.query(
      `SELECT 
        r.id, 
        r.request_text, 
        r.status, 
        r.customer_name,
        r.customer_phone,
        r.created_at,
        r.total_price,
        c.name as category_name,
        c.icon as category_icon,
        ST_X(r.customer_location::geometry) as lng,
        ST_Y(r.customer_location::geometry) as lat,
        r.image_url
       FROM requests r
       JOIN categories c ON r.category_id = c.id
       WHERE r.status = 'pending'
         AND r.category_id = ANY($1)
       ORDER BY r.created_at DESC`,
      [providerCategoryIds]
    );
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error en getPendingRequests:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = getPendingRequests;