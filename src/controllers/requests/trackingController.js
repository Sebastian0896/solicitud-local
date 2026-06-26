const db = require('../../config/database');

const updateProviderLocation = async (req, res) => {
  const { requestId } = req.params;
  const { lat, lng } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat y lng son requeridos' });
  }

  try {
    const result = await db.query(
      `UPDATE requests
       SET provider_lat = $1, provider_lng = $2, provider_location_updated_at = NOW()
       WHERE id = $3 AND status = 'on_the_way'
       RETURNING id`,
      [lat, lng, requestId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado o no está en camino' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('updateProviderLocation error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const getProviderLocation = async (req, res) => {
  const { requestId } = req.params;

  try {
    const result = await db.query(
      `SELECT provider_lat, provider_lng, provider_location_updated_at, status
       FROM requests WHERE id = $1`,
      [requestId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const row = result.rows[0];
    res.json({
      lat: row.provider_lat ? parseFloat(row.provider_lat) : null,
      lng: row.provider_lng ? parseFloat(row.provider_lng) : null,
      updated_at: row.provider_location_updated_at,
      status: row.status,
    });
  } catch (error) {
    console.error('getProviderLocation error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { updateProviderLocation, getProviderLocation };
