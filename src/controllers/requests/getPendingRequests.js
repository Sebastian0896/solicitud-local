const db = require('../../config/database');

// Provider obtiene pedidos pendientes cercanos
const getPendingRequests = async (req, res) => {
  const { lat, lng, radius = 10 } = req.query;
  const providerId = req.user.id;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  
  try {
    // Verificar suscripción activa del provider
    const providerCheck = await db.query(
      'SELECT subscription_active, available, fcm_token FROM users WHERE id = $1',
      [providerId]
    );
    
    if (!providerCheck.rows[0]?.subscription_active) {
      return res.status(403).json({ error: 'Active subscription required' });
    }
    
    if (!providerCheck.rows[0]?.available) {
      return res.status(403).json({ error: 'You must be marked as available to see requests' });
    }
    
    // Buscar pedidos pendientes cerca de la ubicación del provider
    const result = await db.query(
      `SELECT r.id, r.request_text, r.customer_name, r.created_at, r.customer_id,
              ST_Distance(r.customer_location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance_meters
       FROM requests r
       WHERE r.status = 'pending'
         AND ST_DWithin(r.customer_location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000)
       ORDER BY r.created_at DESC`,
      [parseFloat(lng), parseFloat(lat), parseFloat(radius)]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = getPendingRequests;