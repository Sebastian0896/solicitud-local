const db = require('../../config/database');


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

module.exports = cancelAssignedRequest;