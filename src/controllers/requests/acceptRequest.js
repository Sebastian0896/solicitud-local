const db = require('../../config/database');
const FirebaseService = require('../../services/firebaseService');
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
      return res.status(403).json({ error: 'Debes estar activo para aceptar pedidos.' });
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
      `INSERT INTO notifications (user_id, title, body, type, request_id, created_at)
       VALUES ($1, 'Pedido aceptado', $2, 'request_accepted', $3, NOW())`,
      [request.customer_id, `${providerName} ha aceptado tu pedido`, requestId]
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

module.exports = acceptRequest;