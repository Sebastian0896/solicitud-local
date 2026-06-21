const db = require('../../config/database');
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
    const FREE_DAILY_LIMIT = 20;

    if (!provider.available) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Debes estar activo para aceptar pedidos.' });
    }

    // Tier gratuito: máximo FREE_DAILY_LIMIT pedidos por día
    if (!provider.subscription_active) {
      const dailyResult = await client.query(
        `SELECT COUNT(*) FROM requests
         WHERE provider_id = $1
           AND assigned_at >= CURRENT_DATE
           AND assigned_at < CURRENT_DATE + INTERVAL '1 day'`,
        [providerId]
      );
      const dailyCount = parseInt(dailyResult.rows[0].count);
      if (dailyCount >= FREE_DAILY_LIMIT) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'free_limit_reached',
          message: `Alcanzaste el límite de ${FREE_DAILY_LIMIT} pedidos diarios del plan gratuito.`,
          dailyCount,
          limit: FREE_DAILY_LIMIT,
        });
      }
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

    // No notificamos al cliente aquí — se notificará cuando el proveedor asigne el precio
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