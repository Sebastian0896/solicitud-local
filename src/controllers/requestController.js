const db = require('../config/database');
const FirebaseService = require('../services/firebaseService');

// Cliente crea un pedido
const createRequest = async (req, res) => {
  const { requestText, lat, lng } = req.body;
  const customerId = req.user.id;
  const customerName = req.user.name;
  
  if (!requestText || !lat || !lng) {
    return res.status(400).json({ error: 'requestText, lat, and lng are required' });
  }
  
  try {
    // Obtener teléfono del cliente
    const userResult = await db.query('SELECT phone, fcm_token FROM users WHERE id = $1', [customerId]);
    const customerPhone = userResult.rows[0]?.phone || '';
    const customerFcmToken = userResult.rows[0]?.fcm_token;
    
    // Crear el pedido
    const result = await db.query(
      `INSERT INTO requests (customer_id, request_text, status, customer_name, customer_phone, customer_location)
       VALUES ($1, $2, 'pending', $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))
       RETURNING id, created_at`,
      [customerId, requestText, customerName, customerPhone, parseFloat(lng), parseFloat(lat)]
    );
    
    const newRequest = result.rows[0];
    
    // Buscar proveedores cercanos con suscripción activa y disponibles
    const nearbyProviders = await db.query(
      `SELECT id, name, business_name, fcm_token
       FROM users
       WHERE role = 'provider'
         AND is_active = true
         AND subscription_active = true
         AND available = true
         AND ST_DWithin(
           current_location,
           ST_SetSRID(ST_MakePoint($1, $2), 4326),
           10000
         )`,
      [parseFloat(lng), parseFloat(lat)]
    );
    
    // Enviar notificaciones push a proveedores cercanos
    for (const provider of nearbyProviders.rows) {
      if (provider.fcm_token) {
        await FirebaseService.sendNotification(
          provider.fcm_token,
          '📦 Nuevo pedido cercano',
          `${customerName} necesita: ${requestText.substring(0, 50)}...`,
          {
            requestId: newRequest.id,
            type: 'new_request',
            customerName: customerName,
            requestText: requestText.substring(0, 100)
          }
        );
      }
    }
    
    // Crear notificaciones en la base de datos para proveedores cercanos
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
    
    res.status(201).json({
      id: newRequest.id,
      message: 'Request created successfully',
      nearbyProvidersCount: nearbyProviders.rows.length
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ error: error.message });
  }
};

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

// Cliente cancela pedido (solo si está pendiente)
const cancelRequest = async (req, res) => {
  const { requestId } = req.params;
  const customerId = req.user.id;
  
  try {
    const result = await db.query(
      `UPDATE requests 
       SET status = 'cancelled'
       WHERE id = $1 AND customer_id = $2 AND status = 'pending'
       RETURNING id`,
      [requestId, customerId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or cannot be cancelled' });
    }
    
    res.json({ success: true, message: 'Request cancelled' });
  } catch (error) {
    console.error('Cancel request error:', error);
    res.status(500).json({ error: error.message });
  }
};

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

// Provider acepta un pedido
const acceptRequest = async (req, res) => {
  const { requestId } = req.params;
  const providerId = req.user.id;
  const providerName = req.user.business_name || req.user.name;
  
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // Bloquear el pedido y verificar estado
    const requestResult = await client.query(
      `SELECT status, customer_id FROM requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    
    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const request = requestResult.rows[0];
    
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Request already taken' });
    }
    
    // Verificar límite de pedidos activos del provider
    const providerResult = await client.query(
      `SELECT active_requests, max_requests, subscription_active, available, fcm_token 
       FROM users WHERE id = $1 FOR UPDATE`,
      [providerId]
    );
    
    const provider = providerResult.rows[0];
    
    if (!provider.subscription_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Active subscription required' });
    }
    
    if (!provider.available) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You must be available to accept requests' });
    }
    
    if (provider.active_requests >= provider.max_requests) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: `Max requests limit reached (${provider.max_requests})` });
    }
    
    // Actualizar pedido
    await client.query(
      `UPDATE requests 
       SET provider_id = $1, 
           provider_name = $2,
           status = 'assigned', 
           assigned_at = NOW()
       WHERE id = $3`,
      [providerId, providerName, requestId]
    );
    
    // Incrementar active_requests del provider
    await client.query(
      `UPDATE users SET active_requests = active_requests + 1 WHERE id = $1`,
      [providerId]
    );
    
    await client.query('COMMIT');
    
    // Obtener información del cliente para notificación
    const customerResult = await db.query(
      'SELECT fcm_token, name FROM users WHERE id = $1',
      [request.customer_id]
    );
    const customerFcmToken = customerResult.rows[0]?.fcm_token;
    const customerName = customerResult.rows[0]?.name;
    
    // Enviar notificación push al cliente
    if (customerFcmToken) {
      await FirebaseService.sendNotification(
        customerFcmToken,
        '✅ Pedido aceptado',
        `${providerName} ha aceptado tu pedido y estará en camino pronto`,
        {
          requestId: requestId,
          type: 'request_accepted',
          providerName: providerName,
          providerId: providerId
        }
      );
    }
    
    // Crear notificación en base de datos para el cliente
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, created_at)
       VALUES ($1, 'Pedido aceptado', $2, 'request_accepted', NOW())`,
      [request.customer_id, `${providerName} ha aceptado tu pedido`]
    );
    
    res.json({ 
      success: true, 
      message: 'Request accepted successfully' 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Accept request error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

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
      SELECT id, request_text, customer_name, customer_phone, status, created_at, assigned_at
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
      AND status IN ('assigned', 'on_the_way')
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

// Provider actualiza estado del pedido
const updateRequestStatus = async (req, res) => {
  const { requestId } = req.params;
  const { status } = req.body;
  const providerId = req.user.id;
  const providerName = req.user.business_name || req.user.name;
  
  if (!['on_the_way', 'delivered'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Allowed: on_the_way, delivered' });
  }
  
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    const requestResult = await client.query(
      `SELECT status, customer_id FROM requests 
       WHERE id = $1 AND provider_id = $2 FOR UPDATE`,
      [requestId, providerId]
    );
    
    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found or not assigned to you' });
    }
    
    const currentStatus = requestResult.rows[0].status;
    const customerId = requestResult.rows[0].customer_id;
    
    let statusMessage = '';
    let notificationTitle = '';
    
    if (status === 'delivered') {
      if (currentStatus === 'delivered') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Request already delivered' });
      }
      
      // Disminuir active_requests del provider
      await client.query(
        `UPDATE users SET active_requests = GREATEST(active_requests - 1, 0) WHERE id = $1`,
        [providerId]
      );
      
      await client.query(
        `UPDATE requests SET status = $1, completed_at = NOW() WHERE id = $2`,
        [status, requestId]
      );
      
      statusMessage = 'entregado';
      notificationTitle = '📦 Pedido entregado';
    } else {
      await client.query(
        `UPDATE requests SET status = $1 WHERE id = $2`,
        [status, requestId]
      );
      
      statusMessage = 'en camino';
      notificationTitle = '🚚 Pedido en camino';
    }
    
    await client.query('COMMIT');
    
    // Obtener FCM token del cliente
    const customerResult = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [customerId]
    );
    const customerFcmToken = customerResult.rows[0]?.fcm_token;
    
    // Enviar notificación push al cliente
    if (customerFcmToken) {
      await FirebaseService.sendNotification(
        customerFcmToken,
        notificationTitle,
        `Tu pedido está ${statusMessage} con ${providerName}`,
        {
          requestId: requestId,
          type: 'status_update',
          status: status,
          providerName: providerName
        }
      );
    }
    
    // Crear notificación en base de datos
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, created_at)
       VALUES ($1, $2, $3, 'status_update', NOW())`,
      [customerId, notificationTitle, `Tu pedido está ${statusMessage} con ${providerName}`]
    );
    
    res.json({ success: true, status });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update status error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// Provider cancela un pedido asignado
const cancelAssignedRequest = async (req, res) => {
  const { requestId } = req.params;
  const providerId = req.user.id;
  const providerName = req.user.business_name || req.user.name;
  
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // Verificar que el pedido pertenece al provider y está en un estado cancelable
    const requestResult = await client.query(
      `SELECT status, customer_id FROM requests 
       WHERE id = $1 AND provider_id = $2 
       AND status IN ('assigned', 'on_the_way')
       FOR UPDATE`,
      [requestId, providerId]
    );
    
    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        error: 'Request not found, not assigned to you, or cannot be cancelled' 
      });
    }
    
    const customerId = requestResult.rows[0].customer_id;
    
    // Actualizar estado a cancelled
    await client.query(
      `UPDATE requests 
       SET status = 'cancelled', 
           completed_at = NOW()
       WHERE id = $1`,
      [requestId]
    );
    
    // Disminuir active_requests del provider
    await client.query(
      `UPDATE users SET active_requests = GREATEST(active_requests - 1, 0) 
       WHERE id = $1`,
      [providerId]
    );
    
    await client.query('COMMIT');
    
    // Obtener FCM token del cliente
    const customerResult = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [customerId]
    );
    const customerFcmToken = customerResult.rows[0]?.fcm_token;
    
    // Enviar notificación push al cliente
    if (customerFcmToken) {
      await FirebaseService.sendNotification(
        customerFcmToken,
        '❌ Pedido cancelado',
        `${providerName} ha cancelado tu pedido`,
        {
          requestId: requestId,
          type: 'cancelled',
          providerName: providerName
        }
      );
    }
    
    // Crear notificación en base de datos
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, created_at)
       VALUES ($1, 'Pedido cancelado', $2, 'cancelled', NOW())`,
      [customerId, `${providerName} ha cancelado tu pedido`]
    );
    
    res.json({ 
      success: true, 
      message: 'Request cancelled successfully' 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancel assigned request error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = {
  createRequest,
  getCustomerRequests,
  cancelRequest,
  getPendingRequests,
  acceptRequest,
  getProviderAssignedRequests,
  updateRequestStatus,
  cancelAssignedRequest
};