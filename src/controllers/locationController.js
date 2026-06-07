const db = require('../config/database');

// Obtener ubicación de un pedido (customer_location) desde PostGIS
const getRequestLocations = async (req, res) => {
  const { requestId } = req.params;
  
  try {
    // Consulta usando customer_location
    const query = `
      SELECT 
        ST_X(customer_location::geometry) as lng,
        ST_Y(customer_location::geometry) as lat,
        ST_AsGeoJSON(customer_location) as geojson
      FROM requests 
      WHERE id = $1
        AND customer_location IS NOT NULL
    `;
    
    const result = await db.query(query, [requestId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Pedido no encontrado o no tiene ubicación asociada' 
      });
    }
    
    const data = result.rows[0];
    
    res.json({
      pickup: {
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lng),
        geojson: JSON.parse(data.geojson)
      },
      dropoff: null, // No tenemos destino georreferenciado aún
      distanceKm: null
    });
    
  } catch (error) {
    console.error('Error en getRequestLocations:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener proveedores cercanos a una ubicación
const getNearbyProviders = async (req, res) => {
  const { lat, lng, radius = 5, limit = 10 } = req.query;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Se requieren latitud y longitud' });
  }
  
  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const parsedRadius = parseFloat(radius);
  const parsedLimit = parseInt(limit);
  
  try {
    // Asumiendo que la tabla 'users' tiene columna 'location' (geography)
    const query = `
      SELECT 
        id,
        name,
        email,
        phone,
        rating,
        available,
        ST_X(location::geometry) as lng,
        ST_Y(location::geometry) as lat,
        ST_Distance(
          location::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) as distance_meters,
        ST_Distance(
          location::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) / 1000.0 as distance_km,
        (
          SELECT COALESCE(AVG(rating), 0)
          FROM ratings 
          WHERE provider_id = users.id
        ) as avg_rating,
        (
          SELECT COUNT(*) 
          FROM requests 
          WHERE provider_id = users.id 
          AND status = 'completed'
        ) as total_services,
        (
          SELECT COUNT(*) 
          FROM requests 
          WHERE provider_id = users.id 
          AND status = 'completed'
          AND created_at > NOW() - INTERVAL '30 days'
        ) as services_last_30d
      FROM users
      WHERE role = 'provider' 
      AND available = true
      AND ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3 * 1000
      )
      ORDER BY distance_meters ASC
      LIMIT $4
    `;
    
    const result = await db.query(query, [parsedLng, parsedLat, parsedRadius, parsedLimit]);
    
    const providersWithAccuracy = result.rows.map(provider => ({
      ...provider,
      distanceKm: parseFloat(provider.distance_km).toFixed(2),
      distanceMeters: Math.round(provider.distance_meters),
      accuracyScore: calculateAccuracyScore(provider)
    }));
    
    res.json({
      center: { lat: parsedLat, lng: parsedLng },
      radiusKm: parsedRadius,
      providers: providersWithAccuracy
    });
    
  } catch (error) {
    console.error('Error en getNearbyProviders:', error);
    res.status(500).json({ error: error.message });
  }
};

function calculateAccuracyScore(provider) {
  const ratingScore = (provider.avg_rating || 0) * 0.4;
  const servicesScore = Math.min((provider.total_services || 0) / 100, 1) * 0.3;
  const recentServicesScore = Math.min((provider.services_last_30d || 0) / 20, 1) * 0.2;
  const availabilityScore = provider.available ? 0.1 : 0;
  
  return Math.round((ratingScore + servicesScore + recentServicesScore + availabilityScore) * 100);
}

module.exports = {
  getRequestLocations,
  getNearbyProviders
};