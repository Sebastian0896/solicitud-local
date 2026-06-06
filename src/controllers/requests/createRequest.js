const db = require('../../config/database');
const FirebaseService = require('../../services/firebaseService');

const createRequest = async (req, res) => {
  const { requestText, lat, lng } = req.body;
  const customerId = req.user.id;
  const customerName = req.user.name;
  
  if (!requestText || !lat || !lng) {
    return res.status(400).json({ error: 'requestText, lat, and lng are required' });
  }
  
  try {
    const userResult = await db.query('SELECT phone FROM users WHERE id = $1', [customerId]);
    const customerPhone = userResult.rows[0]?.phone || '';
    
    const result = await db.query(
      `INSERT INTO requests (customer_id, request_text, status, customer_name, customer_phone, customer_location)
       VALUES ($1, $2, 'pending', $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))
       RETURNING id, created_at`,
      [customerId, requestText, customerName, customerPhone, parseFloat(lng), parseFloat(lat)]
    );
    
    const newRequest = result.rows[0];
    
    const nearbyProviders = await db.query(
      `SELECT id, name, business_name, fcm_token
       FROM users
       WHERE role = 'provider'
         AND is_active = true
         AND subscription_active = true
         AND available = true
         AND ST_DWithin(current_location, ST_SetSRID(ST_MakePoint($1, $2), 4326), 10000)`,
      [parseFloat(lng), parseFloat(lat)]
    );
    
    for (const provider of nearbyProviders.rows) {
      if (provider.fcm_token) {
        await FirebaseService.sendNotification(
          provider.fcm_token,
          '📦 Nuevo pedido cercano',
          `${customerName} necesita: ${requestText.substring(0, 50)}...`,
          { requestId: newRequest.id, type: 'new_request', customerName, requestText: requestText.substring(0, 100) }
        );
      }
    }
    
    const notifications = nearbyProviders.rows.map(provider => ({
      user_id: provider.id,
      title: 'Nuevo pedido cercano',
      body: `${customerName} necesita: ${requestText.substring(0, 50)}...`,
      type: 'new_request'
    }));
    
    if (notifications.length > 0) {
      const query = `
        INSERT INTO notifications (user_id, title, body, type, created_at)
        VALUES ${notifications.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, NOW())`).join(', ')}
      `;
      const values = notifications.flatMap(n => [n.user_id, n.title, n.body, n.type]);
      await db.query(query, values);
    }
    
    res.status(201).json({ id: newRequest.id, message: 'Request created successfully', nearbyProvidersCount: nearbyProviders.rows.length });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = createRequest;