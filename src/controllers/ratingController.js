const db = require('../config/database');

const submitRating = async (req, res) => {
  const { requestId, rating, comment } = req.body;
  const customerId = req.user.id;

  if (!requestId || !rating) {
    return res.status(400).json({ error: 'requestId y rating son requeridos' });
  }

  const ratingNum = parseInt(rating, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'El rating debe ser entre 1 y 5' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query(
      `SELECT r.id, r.provider_id, r.status,
              EXISTS(SELECT 1 FROM ratings WHERE request_id = r.id) AS already_rated
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
      `UPDATE users SET
         rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM ratings WHERE provider_id = $1),
         rating_count = (SELECT COUNT(*) FROM ratings WHERE provider_id = $1)
       WHERE id = $1`,
      [request.provider_id]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Rating error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

const getProviderRatings = async (req, res) => {
  const { providerId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const ratingsResult = await db.query(
      `SELECT
         rt.id,
         rt.rating,
         rt.comment,
         rt.created_at,
         u.name AS customer_name
       FROM ratings rt
       LEFT JOIN users u ON rt.customer_id = u.id
       WHERE rt.provider_id = $1
       ORDER BY rt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [providerId, limit, offset]
    );

    const summaryResult = await db.query(
      `SELECT
         ROUND(AVG(rating)::numeric, 1) AS average,
         COUNT(*) AS total
       FROM ratings
       WHERE provider_id = $1`,
      [providerId]
    );

    const summary = summaryResult.rows[0];
    res.json({
      average: summary.average ? parseFloat(summary.average) : null,
      total: parseInt(summary.total),
      ratings: ratingsResult.rows,
      limit,
      offset,
    });
  } catch (error) {
    console.error('getProviderRatings error:', error);
    res.status(500).json({ error: error.message });
  }
};

const submitProviderRating = async (req, res) => {
  const { requestId, rating, comment } = req.body;
  const providerId = req.user.id;

  if (!requestId || !rating) {
    return res.status(400).json({ error: 'requestId y rating son requeridos' });
  }
  const ratingNum = parseInt(rating, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'El rating debe ser entre 1 y 5' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query(
      `SELECT r.id, r.customer_id, r.status,
              EXISTS(SELECT 1 FROM ratings WHERE request_id = r.id AND rated_by = 'provider') AS already_rated
       FROM requests r
       WHERE r.id = $1 AND r.provider_id = $2`,
      [requestId, providerId]
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
      return res.status(409).json({ error: 'Ya calificaste a este cliente' });
    }

    await client.query(
      `INSERT INTO ratings (provider_id, customer_id, request_id, rating, comment, rated_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'provider', NOW())`,
      [providerId, request.customer_id, requestId, ratingNum, comment || null]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Provider rating error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = { submitRating, getProviderRatings, submitProviderRating };
