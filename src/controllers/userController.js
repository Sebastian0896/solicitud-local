const db = require('../config/database');

// Provider toggle available status
const toggleAvailability = async (req, res) => {
  const { available } = req.body; // true or false
  const providerId = req.user.id;
  
  if (req.user.role !== 'provider') {
    return res.status(403).json({ error: 'Only providers can toggle availability' });
  }
  
  try {
    // Verificar suscripción activa antes de permitir estar disponible
    if (available === true) {
      const userResult = await db.query(
        'SELECT subscription_active FROM users WHERE id = $1',
        [providerId]
      );
      
      if (!userResult.rows[0]?.subscription_active) {
        return res.status(403).json({ 
          error: 'Active subscription required to receive requests' 
        });
      }
    }
    
    await db.query(
      'UPDATE users SET available = $1 WHERE id = $2',
      [available, providerId]
    );
    
    res.json({ success: true, available });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Actualizar perfil
const updateProfile = async (req, res) => {
  const { name, phone, businessName, serviceRadiusKm, maxRequests, address, addressReference } = req.body;
  const userId = req.user.id;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (name) {
      fields.push(`name = $${idx++}`);
      values.push(name);
    }
    if (phone) {
      fields.push(`phone = $${idx++}`);
      values.push(phone);
    }
    if (businessName && req.user.role === 'provider') {
      fields.push(`business_name = $${idx++}`);
      values.push(businessName);
    }
    if (serviceRadiusKm && req.user.role === 'provider') {
      fields.push(`service_radius_km = $${idx++}`);
      values.push(serviceRadiusKm);
    }
    if (maxRequests && req.user.role === 'provider') {
      fields.push(`max_requests = $${idx++}`);
      values.push(maxRequests);
    }
    if (address !== undefined) {
      fields.push(`address = $${idx++}`);
      values.push(address || null);
    }
    if (addressReference !== undefined) {
      fields.push(`address_reference = $${idx++}`);
      values.push(addressReference || null);
    }
    
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(userId);
    
    await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );
    
    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Actualizar ubicación (para providers en tiempo real)
const updateLocation = async (req, res) => {
  const { lat, lng } = req.body;
  const userId = req.user.id;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }
  
  try {
    await db.query(
      `UPDATE users 
       SET current_location = ST_SetSRID(ST_MakePoint($1, $2), 4326)
       WHERE id = $3`,
      [lng, lat, userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Obtener estadísticas del provider
const getProviderStats = async (req, res) => {
  const providerId = req.user.id;
  
  try {
    const result = await db.query(
      `SELECT 
        COUNT(CASE WHEN status = 'assigned' OR status = 'on_the_way' THEN 1 END) as active_requests,
        COUNT(CASE WHEN status = 'delivered' AND completed_at > NOW() - INTERVAL '7 days' THEN 1 END) as weekly_deliveries,
        AVG(EXTRACT(EPOCH FROM (assigned_at - created_at))) as avg_response_seconds
       FROM requests
       WHERE provider_id = $1`,
      [providerId]
    );
    
    const stats = result.rows[0];
    
    res.json({
      activeRequests: parseInt(stats.active_requests || 0),
      weeklyDeliveries: parseInt(stats.weekly_deliveries || 0),
      avgResponseSeconds: Math.round(stats.avg_response_seconds || 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProfile = async (req, res) => {
  const userId = req.user.id;
  
  try {
    const result = await db.query(
      `SELECT id, email, name, phone, role, business_name,
              available, active_requests, max_requests,
              service_radius_km, subscription_active, subscription_expires_at,
              address, address_reference, is_verified, delivery_code,
              ST_X(current_location::geometry) as lng,
              ST_Y(current_location::geometry) as lat
       FROM users WHERE id = $1`,
      [userId]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const saveFcmToken = async (req, res) => {
  const userId = req.user.id;
  const { fcmToken } = req.body;
  
  if (!fcmToken) {
    return res.status(400).json({ error: 'FCM token is required' });
  }
  
  try {
    await db.query(
      'UPDATE users SET fcm_token = $1 WHERE id = $2',
      [fcmToken, userId]
    );
    
    res.json({ success: true, message: 'FCM token saved' });
  } catch (error) {
    console.error('Error saving FCM token:', error);
    res.status(500).json({ error: error.message });
  }
};

const getProviderPublicProfile = async (req, res) => {
  const { providerId } = req.params;
  try {
    const result = await db.query(
      `SELECT
         u.id,
         u.name,
         u.business_name,
         u.rating,
         u.rating_count,
         u.available,
         COALESCE(
           JSON_AGG(c.name ORDER BY c.name) FILTER (WHERE c.name IS NOT NULL),
           '[]'
         ) AS categories
       FROM users u
       LEFT JOIN provider_categories pc ON pc.provider_id = u.id
       LEFT JOIN categories c ON c.id = pc.category_id
       WHERE u.id = $1 AND u.role = 'provider' AND u.is_active = true
       GROUP BY u.id`,
      [providerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado.' });
    }

    const provider = result.rows[0];
    const stats = await db.query(
      `SELECT COUNT(*) AS completed
       FROM requests
       WHERE provider_id = $1 AND status = 'delivered' AND is_deleted = false`,
      [providerId]
    );

    res.json({
      ...provider,
      completed_requests: parseInt(stats.rows[0]?.completed ?? 0),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  toggleAvailability,
  updateProfile,
  updateLocation,
  getProviderStats,
  getProfile,
  saveFcmToken,
  getProviderPublicProfile,
};