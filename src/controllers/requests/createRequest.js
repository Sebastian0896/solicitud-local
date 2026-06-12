const db = require('../../config/database');
const FirebaseService = require('../../services/firebaseService');
const { getNearbyProviders } = require('../../services/geolocationService');

const createRequest = async (req, res) => {
  const { request_text, category_id, lat, lng } = req.body;
  const customerId = req.user.id;
  const customerName = req.user.name;
  const customerPhone = req.user.phone;

  if (!category_id) {
    return res.status(400).json({ error: 'Debes seleccionar una categoría' });
  }

  try {
    const catCheck = await db.query(
      `SELECT id FROM categories WHERE id = $1 AND is_active = true`,
      [category_id]
    );

    if (catCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Categoría inválida o inactiva' });
    }

    const result = await db.query(
      `INSERT INTO requests 
       (id, customer_id, request_text, status, customer_name, customer_phone, 
        created_at, original_created_at, category_id, customer_location, repeat_count)
       VALUES (gen_random_uuid(), $1, $2, 'pending', $3, $4, NOW(), NOW(), $5, 
               ST_SetSRID(ST_MakePoint($6, $7), 4326), 1)
       RETURNING id`,
      [customerId, request_text, customerName, customerPhone, category_id, lng, lat]
    );

    const requestId = result.rows[0].id;

    res.status(201).json({
      success: true,
      message: 'Pedido creado exitosamente',
      requestId,
    });

    // Notificar proveedores cercanos (fuera del response para no bloquear)
    if (lat && lng) {
      _notifyNearbyProviders({ requestId, request_text, lat, lng }).catch(
        (err) => console.error('Error notificando proveedores cercanos:', err)
      );
    }
  } catch (error) {
    console.error('Error en createRequest:', error);
    res.status(500).json({ error: error.message });
  }
};

async function _notifyNearbyProviders({ requestId, request_text, lat, lng }) {
  const providers = await getNearbyProviders(lat, lng, 15);
  if (!providers.length) return;

  const tokens = providers.map((p) => p.fcm_token).filter(Boolean);
  const preview =
    request_text.length > 60 ? request_text.slice(0, 57) + '...' : request_text;

  if (tokens.length > 0) {
    await FirebaseService.sendMulticastNotification(
      tokens,
      '📋 Nuevo pedido cerca de ti',
      preview,
      { requestId, type: 'new_request' }
    );
  }

  // Guardar notificación en BD para cada proveedor
  if (providers.length > 0) {
    const values = providers
      .map((_, i) => `($${i * 3 + 1}, 'Nuevo pedido cerca de ti', $${i * 3 + 2}, 'new_request', $${i * 3 + 3}, NOW())`)
      .join(', ');
    const params = providers.flatMap((p) => [p.id, preview, requestId]);
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, request_id, created_at) VALUES ${values}`,
      params
    );
  }
}

module.exports = createRequest;
