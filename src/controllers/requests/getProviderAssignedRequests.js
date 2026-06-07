const db = require('../../config/database');

// Provider obtiene sus pedidos asignados
const getProviderAssignedRequests = async (req, res) => {
  const providerId = req.user.id;
  
  try {
    // Obtener ubicación del proveedor para calcular distancia
    const providerResult = await db.query(
      'SELECT ST_X(current_location::geometry) as lng, ST_Y(current_location::geometry) as lat FROM users WHERE id = $1',
      [providerId]
    );
    
    const providerLat = providerResult.rows[0]?.lat;
    const providerLng = providerResult.rows[0]?.lng;
    
    let query = `
      SELECT id, request_text, customer_name, customer_phone, status, created_at, assigned_at, total_price
    `;
    
    if (providerLat && providerLng) {
      query += `,
        ST_Distance(
          customer_location, 
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) as distance_meters
      `;
    }
    
    query += ` FROM requests 
      WHERE provider_id = $${providerLat && providerLng ? '3' : '1'} 
      AND status IN ('assigned', 'on_the_way', 'waiting_confirmation')
      ORDER BY assigned_at DESC
    `;
    
    const params = [];
    if (providerLat && providerLng) {
      params.push(providerLng, providerLat, providerId);
    } else {
      params.push(providerId);
    }
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get assigned requests error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = getProviderAssignedRequests;