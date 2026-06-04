const db = require('../config/database');

// Buscar proveedores cercanos a una ubicación
const getNearbyProviders = async (lat, lng, radiusKm = 5) => {
  try {
    const result = await db.query(
      `SELECT id, name, business_name, fcm_token
       FROM users
       WHERE role = 'provider'
         AND is_active = true
         AND subscription_active = true
         AND available = true
         AND ST_DWithin(
           current_location,
           ST_SetSRID(ST_MakePoint($1, $2), 4326),
           $3 * 1000
         )`,
      [lng, lat, radiusKm]
    );
    
    return result.rows;
  } catch (error) {
    console.error('Error getting nearby providers:', error);
    return [];
  }
};

// Calcular distancia entre dos puntos (en metros)
const calculateDistance = async (point1Lat, point1Lng, point2Lat, point2Lng) => {
  const result = await db.query(
    `SELECT ST_Distance(
      ST_SetSRID(ST_MakePoint($1, $2), 4326),
      ST_SetSRID(ST_MakePoint($3, $4), 4326)
    ) as distance`,
    [point1Lng, point1Lat, point2Lng, point2Lat]
  );
  
  return result.rows[0]?.distance || 0;
};

// Emitir evento a proveedores cercanos (socket.io)
let ioInstance = null;

const setSocketIO = (io) => {
  ioInstance = io;
};

const emitToNearbyProviders = (providers, eventData) => {
  if (!ioInstance) return;
  
  providers.forEach(provider => {
    ioInstance.to(`user:${provider.id}`).emit('new_request', eventData);
  });
};

module.exports = {
  getNearbyProviders,
  calculateDistance,
  setSocketIO,
  emitToNearbyProviders
};