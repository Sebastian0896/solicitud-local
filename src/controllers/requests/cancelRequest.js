const db = require('../../config/database');
const FirebaseService = require('../../services/firebaseService');
const cancelRequest = async (req, res) => {
  const { requestId } = req.params;
  const customerId = req.user.id;

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const requestResult = await client.query(
      `SELECT
          provider_id,
          provider_name,
          status
       FROM requests
       WHERE id = $1
       AND customer_id = $2
       FOR UPDATE`,
      [requestId, customerId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Request not found'
      });
    }

    const request = requestResult.rows[0];

    if (
      !['pending', 'assigned', 'on_the_way'].includes(
        request.status
      )
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Request cannot be cancelled'
      });
    }

    await client.query(
      `UPDATE requests
       SET status = 'cancelled',
           completed_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    // Si había proveedor asignado,
    // liberar un espacio
    if (request.provider_id) {
      await client.query(
        `UPDATE users
         SET active_requests =
           GREATEST(active_requests - 1, 0)
         WHERE id = $1`,
        [request.provider_id]
      );
    }

    await client.query('COMMIT');

    // Notificar proveedor
    if (request.provider_id) {
      const providerResult = await db.query(
        `SELECT fcm_token
         FROM users
         WHERE id = $1`,
        [request.provider_id]
      );

      const providerFcmToken =
        providerResult.rows[0]?.fcm_token;

      if (providerFcmToken) {
        await FirebaseService.sendNotification(
          providerFcmToken,
          '❌ Pedido cancelado',
          'El cliente canceló el pedido asignado',
          {
            requestId,
            type: 'customer_cancelled'
          }
        );
      }

      await db.query(
        `INSERT INTO notifications
         (
           user_id,
           title,
           body,
           type,
           created_at
         )
         VALUES
         (
           $1,
           'Pedido cancelado',
           'El cliente canceló el pedido asignado',
           'customer_cancelled',
           NOW()
         )`,
        [request.provider_id]
      );
    }

    res.json({
      success: true,
      message: 'Request cancelled'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancel request error:', error);

    res.status(500).json({
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = cancelRequest;