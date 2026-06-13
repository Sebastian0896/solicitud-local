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

    const reqResult = await client.query(
      `SELECT r.id, r.provider_id, r.status,
              (SELECT COUNT(*) FROM ratings WHERE request_id = r.id) > 0 AS already_rated
       FROM requests r
       WHERE r.id = $1 AND r.customer_id = $2`,
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

    if (request.already_rated) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya calificaste este pedido' });
    }

    await client.query(
      `INSERT INTO ratings (provider_id, customer_id, request_id, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [request.provider_id, customerId, requestId, ratingNum, comment || null]
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
