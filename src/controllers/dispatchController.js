// src/controllers/dispatchController.js
const db = require('../config/database');
const logger = require('../utils/logger');
const FirebaseService = require('../services/firebaseService');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const generateDispatchCode = async () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code, exists;
  do {
    const suffix = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    code = `DSP-${suffix}`;
    const result = await db.query(
      'SELECT id FROM dispatch_codes WHERE code = $1',
      [code]
    );
    exists = result.rows.length > 0;
  } while (exists);
  return code;
};

// Consulta de un código de despacho con sus pedidos y conteos
const fetchDispatchWithRequests = async (dispatchId) => {
  const dispatch = await db.query(
    `SELECT
       dc.id, dc.code, dc.status, dc.date, dc.created_at,
       dc.provider_id, dc.delivery_id,
       u.name AS delivery_name, u.delivery_code,
       COUNT(dcr.request_id)                                           AS total,
       COUNT(CASE WHEN r.status = 'delivered' THEN 1 END)             AS delivered,
       COUNT(CASE WHEN r.status != 'delivered' THEN 1 END)            AS pending
     FROM dispatch_codes dc
     LEFT JOIN users u       ON u.id = dc.delivery_id
     LEFT JOIN dispatch_code_requests dcr ON dcr.dispatch_code_id = dc.id
     LEFT JOIN requests r    ON r.id = dcr.request_id
     WHERE dc.id = $1
     GROUP BY dc.id, u.name, u.delivery_code`,
    [dispatchId]
  );
  if (dispatch.rows.length === 0) return null;

  const requests = await db.query(
    `SELECT
       r.id, r.request_text, r.status, r.customer_name, r.customer_phone,
       r.provider_name,
       cu.address AS customer_address,
       cu.address_reference AS customer_address_reference,
       ST_Y(r.customer_location::geometry) AS lat,
       ST_X(r.customer_location::geometry) AS lng
     FROM dispatch_code_requests dcr
     JOIN requests r ON r.id = dcr.request_id
     LEFT JOIN users cu ON cu.id = r.customer_id
     WHERE dcr.dispatch_code_id = $1
     ORDER BY dcr.added_at`,
    [dispatchId]
  );

  return { ...dispatch.rows[0], requests: requests.rows };
};

// ──────────────────────────────────────────────
// PROVEEDOR: Crear código de despacho
// POST /api/dispatch
// ──────────────────────────────────────────────
const createDispatchCode = async (req, res) => {
  const providerId = req.user.id;
  const { date } = req.body;

  try {
    const code = await generateDispatchCode();
    const result = await db.query(
      `INSERT INTO dispatch_codes (code, provider_id, date)
       VALUES ($1, $2, $3)
       RETURNING id, code, status, date, created_at`,
      [code, providerId, date || new Date().toISOString().split('T')[0]]
    );

    logger.info('Dispatch code creado', { providerId, code });
    res.status(201).json({ success: true, dispatch: result.rows[0] });
  } catch (error) {
    logger.error('createDispatchCode error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Listar sus códigos de despacho
// GET /api/dispatch
// ──────────────────────────────────────────────
const getProviderDispatchCodes = async (req, res) => {
  const providerId = req.user.id;

  try {
    const result = await db.query(
      `SELECT
         dc.id, dc.code, dc.status, dc.date, dc.created_at,
         u.name AS delivery_name,
         COUNT(dcr.request_id)                                AS total,
         COUNT(CASE WHEN r.status = 'delivered' THEN 1 END)  AS delivered
       FROM dispatch_codes dc
       LEFT JOIN users u        ON u.id = dc.delivery_id
       LEFT JOIN dispatch_code_requests dcr ON dcr.dispatch_code_id = dc.id
       LEFT JOIN requests r     ON r.id = dcr.request_id
       WHERE dc.provider_id = $1
       GROUP BY dc.id, u.name
       ORDER BY dc.created_at DESC`,
      [providerId]
    );

    res.json({ success: true, dispatches: result.rows });
  } catch (error) {
    logger.error('getProviderDispatchCodes error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR / DELIVERY: Ver detalle de un código
// GET /api/dispatch/:id
// ──────────────────────────────────────────────
const getDispatchCode = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const role = req.user.role;

  try {
    const data = await fetchDispatchWithRequests(id);
    if (!data) return res.status(404).json({ error: 'Código de despacho no encontrado.' });

    // Sólo el proveedor dueño o el delivery asignado pueden verlo
    if (data.provider_id !== userId && data.delivery_id !== userId) {
      return res.status(403).json({ error: 'Sin acceso a este despacho.' });
    }

    res.json({ success: true, dispatch: data });
  } catch (error) {
    logger.error('getDispatchCode error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Agregar pedido al código (máx 10)
// POST /api/dispatch/:id/requests
// ──────────────────────────────────────────────
const addRequestToDispatch = async (req, res) => {
  const { id } = req.params;
  const { requestId } = req.body;
  const providerId = req.user.id;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Verificar que el código pertenece al proveedor y está en estado válido
    const dispatch = await client.query(
      `SELECT id, status FROM dispatch_codes
       WHERE id = $1 AND provider_id = $2 FOR UPDATE`,
      [id, providerId]
    );
    if (dispatch.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Código de despacho no encontrado.' });
    }
    if (!['pending', 'active'].includes(dispatch.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes modificar un despacho en tránsito o completado.' });
    }

    // Verificar límite de 10 pedidos
    const count = await client.query(
      'SELECT COUNT(*) FROM dispatch_code_requests WHERE dispatch_code_id = $1',
      [id]
    );
    if (parseInt(count.rows[0].count) >= 10) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Un código de despacho puede tener máximo 10 pedidos.' });
    }

    // Verificar que el pedido pertenece al proveedor y está en estado asignable
    const request = await client.query(
      `SELECT id, status FROM requests
       WHERE id = $1 AND provider_id = $2`,
      [requestId, providerId]
    );
    if (request.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado o no te pertenece.' });
    }
    if (!['assigned', 'price_confirmed'].includes(request.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo puedes despachar pedidos aceptados.' });
    }

    // Verificar que el pedido no esté en otro código activo
    const inOtherDispatch = await client.query(
      `SELECT dcr.dispatch_code_id FROM dispatch_code_requests dcr
       JOIN dispatch_codes dc ON dc.id = dcr.dispatch_code_id
       WHERE dcr.request_id = $1 AND dc.status NOT IN ('completed')`,
      [requestId]
    );
    if (inOtherDispatch.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este pedido ya está en otro código de despacho activo.' });
    }

    await client.query(
      'INSERT INTO dispatch_code_requests (dispatch_code_id, request_id) VALUES ($1, $2)',
      [id, requestId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Pedido agregado al despacho.' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('addRequestToDispatch error', { error: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Quitar pedido del código
// DELETE /api/dispatch/:id/requests/:requestId
// ──────────────────────────────────────────────
const removeRequestFromDispatch = async (req, res) => {
  const { id, requestId } = req.params;
  const providerId = req.user.id;

  try {
    const dispatch = await db.query(
      `SELECT status FROM dispatch_codes WHERE id = $1 AND provider_id = $2`,
      [id, providerId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Código de despacho no encontrado.' });
    }
    if (!['pending', 'active'].includes(dispatch.rows[0].status)) {
      return res.status(400).json({ error: 'No puedes modificar un despacho en tránsito.' });
    }

    await db.query(
      'DELETE FROM dispatch_code_requests WHERE dispatch_code_id = $1 AND request_id = $2',
      [id, requestId]
    );

    res.json({ success: true, message: 'Pedido removido del despacho.' });
  } catch (error) {
    logger.error('removeRequestFromDispatch error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Asignar delivery por su código DEL-XXXX
// POST /api/dispatch/:id/assign
// ──────────────────────────────────────────────
const assignDelivery = async (req, res) => {
  const { id } = req.params;
  const { deliveryCode } = req.body;
  const providerId = req.user.id;

  try {
    // Buscar el delivery por su código personal
    const deliveryResult = await db.query(
      `SELECT id, name FROM users WHERE delivery_code = $1 AND role = 'delivery' AND is_active = true`,
      [deliveryCode.toUpperCase()]
    );
    if (deliveryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Código de delivery no encontrado.' });
    }
    const delivery = deliveryResult.rows[0];

    // Verificar que el código pertenece al proveedor
    const dispatch = await db.query(
      `SELECT status FROM dispatch_codes WHERE id = $1 AND provider_id = $2`,
      [id, providerId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Código de despacho no encontrado.' });
    }
    if (dispatch.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Este despacho ya está completado.' });
    }

    // Verificar que tenga al menos 1 pedido antes de asignar
    const count = await db.query(
      'SELECT COUNT(*) FROM dispatch_code_requests WHERE dispatch_code_id = $1',
      [id]
    );
    if (parseInt(count.rows[0].count) === 0) {
      return res.status(400).json({ error: 'Agrega al menos un pedido antes de asignar un delivery.' });
    }

    await db.query(
      `UPDATE dispatch_codes SET delivery_id = $1, status = 'pending' WHERE id = $2`,
      [delivery.id, id]
    );

    // Notificar al delivery
    const deliveryFcm = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [delivery.id]
    );
    if (deliveryFcm.rows[0]?.fcm_token) {
      await FirebaseService.sendNotification(
        deliveryFcm.rows[0].fcm_token,
        '📦 Nuevo despacho asignado',
        'Tienes pedidos asignados pendientes de confirmar.',
        { type: 'dispatch_assigned', dispatchId: id }
      );
    }

    logger.info('Delivery asignado al despacho', { dispatchId: id, deliveryId: delivery.id });
    res.json({ success: true, delivery: { id: delivery.id, name: delivery.name } });
  } catch (error) {
    logger.error('assignDelivery error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// DELIVERY: Listar sus despachos asignados
// GET /api/dispatch/my
// ──────────────────────────────────────────────
const getDeliveryDispatchCodes = async (req, res) => {
  const deliveryId = req.user.id;

  try {
    const result = await db.query(
      `SELECT
         dc.id, dc.code, dc.status, dc.date, dc.created_at,
         u.business_name AS provider_business, u.name AS provider_name,
         COUNT(dcr.request_id)                                AS total,
         COUNT(CASE WHEN r.status = 'delivered' THEN 1 END)  AS delivered
       FROM dispatch_codes dc
       JOIN users u ON u.id = dc.provider_id
       LEFT JOIN dispatch_code_requests dcr ON dcr.dispatch_code_id = dc.id
       LEFT JOIN requests r ON r.id = dcr.request_id
       WHERE dc.delivery_id = $1 AND dc.status NOT IN ('completed', 'fulfilled')
       GROUP BY dc.id, u.business_name, u.name
       ORDER BY dc.date DESC, dc.created_at DESC`,
      [deliveryId]
    );

    res.json({ success: true, dispatches: result.rows });
  } catch (error) {
    logger.error('getDeliveryDispatchCodes error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// DELIVERY: Confirmar un despacho asignado
// POST /api/dispatch/:id/confirm
// ──────────────────────────────────────────────
const confirmDispatch = async (req, res) => {
  const { id } = req.params;
  const deliveryId = req.user.id;

  try {
    const dispatch = await db.query(
      `SELECT status, provider_id FROM dispatch_codes
       WHERE id = $1 AND delivery_id = $2`,
      [id, deliveryId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Despacho no encontrado.' });
    }
    if (dispatch.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Este despacho ya fue confirmado.' });
    }

    await db.query(
      `UPDATE dispatch_codes SET status = 'active' WHERE id = $1`,
      [id]
    );

    // Notificar al proveedor
    const providerFcm = await db.query(
      'SELECT fcm_token, business_name, name FROM users WHERE id = $1',
      [dispatch.rows[0].provider_id]
    );
    if (providerFcm.rows[0]?.fcm_token) {
      const deliveryName = req.user.business_name || req.user.name;
      await FirebaseService.sendNotification(
        providerFcm.rows[0].fcm_token,
        '✅ Despacho confirmado',
        `${deliveryName} confirmó el despacho y está listo para salir.`,
        { type: 'dispatch_confirmed', dispatchId: id }
      );
    }

    res.json({ success: true, message: 'Despacho confirmado.' });
  } catch (error) {
    logger.error('confirmDispatch error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// DELIVERY: Salir a entregar (todos los pedidos → on_the_way)
// POST /api/dispatch/:id/depart
// ──────────────────────────────────────────────
const departDispatch = async (req, res) => {
  const { id } = req.params;
  const deliveryId = req.user.id;
  const deliveryName = req.user.business_name || req.user.name;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const dispatch = await client.query(
      `SELECT dc.status, dc.provider_id,
              array_agg(dcr.request_id) AS request_ids
       FROM dispatch_codes dc
       LEFT JOIN dispatch_code_requests dcr ON dcr.dispatch_code_id = dc.id
       WHERE dc.id = $1 AND dc.delivery_id = $2
       GROUP BY dc.id`,
      [id, deliveryId]
    );
    if (dispatch.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Despacho no encontrado.' });
    }
    if (dispatch.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Confirma el despacho antes de salir.' });
    }

    const requestIds = dispatch.rows[0].request_ids.filter(Boolean);
    if (requestIds.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este despacho no tiene pedidos.' });
    }

    // Actualizar todos los pedidos a on_the_way
    await client.query(
      `UPDATE requests SET status = 'on_the_way'
       WHERE id = ANY($1::uuid[]) AND status NOT IN ('delivered', 'cancelled')`,
      [requestIds]
    );

    await client.query(
      `UPDATE dispatch_codes SET status = 'in_transit' WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    // Notificar a cada cliente
    const customers = await db.query(
      `SELECT r.customer_id, u.fcm_token, r.id AS request_id
       FROM requests r
       JOIN users u ON u.id = r.customer_id
       WHERE r.id = ANY($1::uuid[]) AND u.fcm_token IS NOT NULL`,
      [requestIds]
    );

    for (const c of customers.rows) {
      await FirebaseService.sendNotification(
        c.fcm_token,
        '🚚 Tu pedido está en camino',
        `${deliveryName} está en camino a tu ubicación.`,
        { type: 'status_update', status: 'on_the_way', requestId: c.request_id }
      ).catch(() => {});
    }

    // Notificar al proveedor que el delivery salió
    const providerFcm = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [dispatch.rows[0].provider_id]
    );
    if (providerFcm.rows[0]?.fcm_token) {
      await FirebaseService.sendNotification(
        providerFcm.rows[0].fcm_token,
        '🚚 Delivery en camino',
        `${deliveryName} salió a entregar ${requestIds.length} pedido(s).`,
        { type: 'dispatch_departed', dispatchId: id }
      ).catch(() => {});
    }

    res.json({ success: true, message: 'Pedidos marcados como en camino.' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('departDispatch error', { error: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ──────────────────────────────────────────────
// DELIVERY: Marcar un pedido individual como entregado
// POST /api/dispatch/:id/deliver/:requestId
// ──────────────────────────────────────────────
const deliverRequest = async (req, res) => {
  const { id, requestId } = req.params;
  const deliveryId = req.user.id;
  const deliveryName = req.user.business_name || req.user.name;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Verificar que el pedido pertenece al despacho del delivery
    const check = await client.query(
      `SELECT dc.provider_id, r.customer_id, r.status, r.provider_id AS req_provider_id
       FROM dispatch_codes dc
       JOIN dispatch_code_requests dcr ON dcr.dispatch_code_id = dc.id
       JOIN requests r ON r.id = dcr.request_id
       WHERE dc.id = $1 AND dc.delivery_id = $2 AND dcr.request_id = $3
         AND dc.status = 'in_transit'`,
      [id, deliveryId, requestId]
    );
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado en este despacho.' });
    }
    if (check.rows[0].status === 'delivered') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este pedido ya fue entregado.' });
    }

    const { customer_id, req_provider_id } = check.rows[0];

    // Marcar pedido como entregado
    await client.query(
      `UPDATE requests SET status = 'delivered', completed_at = NOW() WHERE id = $1`,
      [requestId]
    );

    // Decrementar active_requests del proveedor
    await client.query(
      `UPDATE users SET active_requests = GREATEST(active_requests - 1, 0) WHERE id = $1`,
      [req_provider_id]
    );

    // Si todos los pedidos del despacho fueron entregados → fulfilled (proveedor decide qué hacer)
    const remaining = await client.query(
      `SELECT COUNT(*) FROM dispatch_code_requests dcr
       JOIN requests r ON r.id = dcr.request_id
       WHERE dcr.dispatch_code_id = $1 AND r.status != 'delivered'`,
      [id]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await client.query(
        `UPDATE dispatch_codes SET status = 'fulfilled' WHERE id = $1`,
        [id]
      );
    }

    await client.query('COMMIT');

    // Notificar al cliente
    const customer = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [customer_id]
    );
    if (customer.rows[0]?.fcm_token) {
      await FirebaseService.sendNotification(
        customer.rows[0].fcm_token,
        '📦 Pedido entregado',
        `${deliveryName} ha entregado tu pedido.`,
        { type: 'status_update', status: 'delivered', requestId }
      ).catch(() => {});
    }

    // Notificar al proveedor del estado de entrega
    const providerFcm = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [req_provider_id]
    );
    if (providerFcm.rows[0]?.fcm_token) {
      const allDone = parseInt(remaining.rows[0].count) === 0;
      await FirebaseService.sendNotification(
        providerFcm.rows[0].fcm_token,
        allDone ? '✅ Todos los pedidos entregados' : '📦 Pedido entregado',
        allDone
          ? `${deliveryName} completó todos los pedidos del despacho.`
          : `${deliveryName} entregó un pedido.`,
        { type: 'dispatch_delivered', dispatchId: id, requestId }
      ).catch(() => {});
    }

    res.json({ success: true, message: 'Pedido marcado como entregado.' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('deliverRequest error', { error: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Buscar delivery por código para lookup
// GET /api/dispatch/lookup-delivery?code=DEL-XXXX
// ──────────────────────────────────────────────
const lookupDelivery = async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Código requerido.' });

  try {
    const result = await db.query(
      `SELECT id, name, phone FROM users
       WHERE delivery_code = $1 AND role = 'delivery' AND is_active = true`,
      [code.toUpperCase()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Código de delivery no encontrado.' });
    }
    res.json({ success: true, delivery: result.rows[0] });
  } catch (error) {
    logger.error('lookupDelivery error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Eliminar un despacho (solo si está pendiente)
// DELETE /api/dispatch/:id
// ──────────────────────────────────────────────
const deleteDispatchCode = async (req, res) => {
  const { id } = req.params;
  const providerId = req.user.id;

  try {
    const dispatch = await db.query(
      `SELECT status FROM dispatch_codes WHERE id = $1 AND provider_id = $2`,
      [id, providerId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Código de despacho no encontrado.' });
    }
    if (!['pending', 'active'].includes(dispatch.rows[0].status)) {
      return res.status(400).json({ error: 'Solo puedes eliminar despachos que aún no han salido.' });
    }

    await db.query('DELETE FROM dispatch_code_requests WHERE dispatch_code_id = $1', [id]);
    await db.query('DELETE FROM dispatch_codes WHERE id = $1', [id]);
    res.json({ success: true, message: 'Despacho eliminado.' });
  } catch (error) {
    logger.error('deleteDispatchCode error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Pedidos disponibles para agregar al despacho
// GET /api/dispatch/:id/available-requests
// ──────────────────────────────────────────────
const getAvailableRequests = async (req, res) => {
  const { id } = req.params;
  const providerId = req.user.id;

  try {
    // Verificar que el despacho pertenece al proveedor
    const dispatch = await db.query(
      `SELECT id FROM dispatch_codes WHERE id = $1 AND provider_id = $2`,
      [id, providerId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Código de despacho no encontrado.' });
    }

    // Pedidos del proveedor en estado asignable y que no estén en un despacho activo
    const result = await db.query(
      `SELECT r.id, r.request_text, r.customer_name, r.customer_phone,
              r.status, r.total_price,
              ST_Y(r.customer_location::geometry) AS lat,
              ST_X(r.customer_location::geometry) AS lng
       FROM requests r
       WHERE r.provider_id = $1
         AND r.status IN ('assigned', 'price_confirmed')
         AND r.id NOT IN (
           SELECT dcr.request_id
           FROM dispatch_code_requests dcr
           JOIN dispatch_codes dc ON dc.id = dcr.dispatch_code_id
           WHERE dc.status NOT IN ('completed')
         )
       ORDER BY r.assigned_at DESC`,
      [providerId]
    );

    res.json({ success: true, requests: result.rows });
  } catch (error) {
    logger.error('getAvailableRequests error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Cerrar despacho completado (fulfilled → completed)
// POST /api/dispatch/:id/close
// ──────────────────────────────────────────────
const closeDispatch = async (req, res) => {
  const { id } = req.params;
  const providerId = req.user.id;

  try {
    const dispatch = await db.query(
      `SELECT status FROM dispatch_codes WHERE id = $1 AND provider_id = $2`,
      [id, providerId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Despacho no encontrado.' });
    }
    if (!['active', 'fulfilled'].includes(dispatch.rows[0].status)) {
      return res.status(400).json({ error: 'No puedes cerrar un despacho que está en tránsito o ya está cerrado.' });
    }

    await db.query(`UPDATE dispatch_codes SET status = 'completed' WHERE id = $1`, [id]);
    logger.info('Despacho cerrado por proveedor', { dispatchId: id, providerId });
    res.json({ success: true, message: 'Despacho cerrado.' });
  } catch (error) {
    logger.error('closeDispatch error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// PROVEEDOR: Reabrir despacho (fulfilled → active)
// POST /api/dispatch/:id/reopen
// ──────────────────────────────────────────────
const reopenDispatch = async (req, res) => {
  const { id } = req.params;
  const providerId = req.user.id;

  try {
    const dispatch = await db.query(
      `SELECT dc.status, dc.delivery_id, u.fcm_token, u.name AS delivery_name
       FROM dispatch_codes dc
       LEFT JOIN users u ON u.id = dc.delivery_id
       WHERE dc.id = $1 AND dc.provider_id = $2`,
      [id, providerId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Despacho no encontrado.' });
    }
    if (dispatch.rows[0].status !== 'fulfilled') {
      return res.status(400).json({ error: 'Solo puedes reabrir un despacho completamente entregado.' });
    }

    await db.query(`UPDATE dispatch_codes SET status = 'active' WHERE id = $1`, [id]);

    // Notificar al delivery que hay nuevos pedidos por recoger
    if (dispatch.rows[0].fcm_token) {
      await FirebaseService.sendNotification(
        dispatch.rows[0].fcm_token,
        '📦 Despacho reabierto',
        'El negocio reabrió el despacho. Revisa si hay nuevos pedidos.',
        { type: 'dispatch_reopened', dispatchId: id }
      ).catch(() => {});
    }

    logger.info('Despacho reabierto por proveedor', { dispatchId: id, providerId });
    res.json({ success: true, message: 'Despacho reabierto.' });
  } catch (error) {
    logger.error('reopenDispatch error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────
// DELIVERY: Rechazar un despacho asignado (solo si está pending)
// POST /api/dispatch/:id/reject
// ──────────────────────────────────────────────
const rejectDispatch = async (req, res) => {
  const { id } = req.params;
  const deliveryId = req.user.id;
  const deliveryName = req.user.name;

  try {
    const dispatch = await db.query(
      `SELECT status, provider_id FROM dispatch_codes WHERE id = $1 AND delivery_id = $2`,
      [id, deliveryId]
    );
    if (dispatch.rows.length === 0) {
      return res.status(404).json({ error: 'Despacho no encontrado.' });
    }
    if (dispatch.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Solo puedes rechazar un despacho pendiente de confirmar.' });
    }

    await db.query(
      `UPDATE dispatch_codes SET delivery_id = NULL, status = 'pending' WHERE id = $1`,
      [id]
    );

    // Notificar al proveedor
    const providerFcm = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [dispatch.rows[0].provider_id]
    );
    if (providerFcm.rows[0]?.fcm_token) {
      await FirebaseService.sendNotification(
        providerFcm.rows[0].fcm_token,
        '❌ Despacho rechazado',
        `${deliveryName} rechazó el despacho. Asigna un nuevo delivery.`,
        { type: 'dispatch_rejected', dispatchId: id }
      ).catch(() => {});
    }

    logger.info('Despacho rechazado', { dispatchId: id, deliveryId });
    res.json({ success: true, message: 'Despacho rechazado.' });
  } catch (error) {
    logger.error('rejectDispatch error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createDispatchCode,
  getProviderDispatchCodes,
  getDispatchCode,
  addRequestToDispatch,
  removeRequestFromDispatch,
  assignDelivery,
  getDeliveryDispatchCodes,
  confirmDispatch,
  departDispatch,
  deliverRequest,
  closeDispatch,
  reopenDispatch,
  rejectDispatch,
  lookupDelivery,
  deleteDispatchCode,
  getAvailableRequests,
};
