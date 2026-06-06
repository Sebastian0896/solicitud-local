const db = require('../../config/database');
const FirebaseService = require('../../services/firebaseService');
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


module.exports = updateRequestStatus;