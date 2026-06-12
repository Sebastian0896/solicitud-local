const db = require('../config/database');

// POST /api/ratings  { requestId, rating, comment }
const submitRating = async (req, res) => {
  const { requestId, rating, comment } = req.body;
  const customerId = req.user.id;

  if (!requestId || !rating) {
    return res.status(400).json({ error: 'requestId y rating son requeridos' });
  }

  const ratingNum = parseInt(rating, 10);
  if (ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'El rating debe ser entre 1 y 5' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Verificar que el pedido pertenece al cliente y está entregado
    const reqResult = await client.query(
      `SELECT id, provider_id, status, rated_by_customer
       FROM requests WHERE id = $1 AND customer_id = $2`,
      [requestId, customerId]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const request = reqResult.rows[0];

    if (request.status !== 'delivered') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo puedes calificar pedidos entregados' });
    }

    if (request.rated_by_customer) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya calificaste este pedido' });
    }

    // Insertar en tabla ratings
    await client.query(
      `INSERT INTO ratings (provider_id, customer_id, request_id, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (request_id) DO UPDATE SET rating = $4, comment = $5`,
      [request.provider_id, customerId, requestId, ratingNum, comment || null]
    );

    // Marcar el pedido como calificado y actualizar rating promedio del proveedor
    await client.query(
      `UPDATE requests SET rated_by_customer = true WHERE id = $1`,
      [requestId]
    );

    await client.query(
      `UPDATE users
       SET rating = (
         SELECT ROUND(AVG(rating)::numeric, 1)
         FROM ratings WHERE provider_id = $1
       )
       WHERE id = $1`,
      [request.provider_id]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Rating error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = { submitRating };
