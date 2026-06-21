const db = require('../config/database');
const logger = require('../utils/logger');
const FirebaseService = require('../services/firebaseService');

// Agregar evento a un pedido
const addRequestEvent = async (req, res) => {
  const { id } = req.params;
  const { event_type, event_data } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  logger.info('Evento request recibido', { 
    requestId: id, 
    userId,
    event_type: req.body.event_type 
  });
  
  // Validar campos requeridos
  if (!event_type || !event_data) {
    return res.status(400).json({ error: 'event_type y event_data son requeridos' });
  }
  
  // Validar tipos de evento permitidos
  const allowedEvents = [
    'price_assigned', 'price_updated', 'price_accepted', 'price_rejected',
    'message', 'counter_offer', 'status_change'
  ];
  
  if (!allowedEvents.includes(event_type)) {
    return res.status(400).json({ error: 'Tipo de evento no válido' });
  }
  
  try {
    // Obtener información del pedido
    const requestResult = await db.query(
      `SELECT customer_id, provider_id, status FROM requests WHERE id = $1`,
      [id]
    );
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    const request = requestResult.rows[0];
    const isCustomer = request.customer_id === userId;
    const isProvider = request.provider_id === userId;
    
    // Verificar permisos según tipo de evento
    if (event_type === 'price_assigned' || event_type === 'price_updated') {
      if (!isProvider) {
        return res.status(403).json({ error: 'Solo el proveedor puede asignar precio' });
      }
    }
    
    if (event_type === 'price_accepted' || event_type === 'price_rejected') {
      if (!isCustomer) {
        return res.status(403).json({ error: 'Solo el cliente puede aceptar/rechazar precio' });
      }
    }
    
    if (event_type === 'message') {
      if (!isCustomer && !isProvider) {
        return res.status(403).json({ error: 'No autorizado para enviar mensajes' });
      }
    }
    
    if (event_type === 'counter_offer') {
      if (!isCustomer) {
        return res.status(403).json({ error: 'Solo el cliente puede hacer contraofertas' });
      }
    }
    
    // Guardar evento
    const result = await db.query(
      `INSERT INTO request_events (request_id, event_type, event_data, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [id, event_type, event_data, userId]
    );
    
    // 👇 ACTUALIZAR requests según el tipo de evento
    if (event_type === 'price_assigned') {
      const amount = event_data.amount;
      await db.query(
        `UPDATE requests SET total_price = $1, status = 'waiting_confirmation' WHERE id = $2`,
        [amount, id]
      );
      // Notificar al cliente: pedido aceptado + precio propuesto
      const customerFcm = await db.query('SELECT fcm_token FROM users WHERE id = $1', [request.customer_id]);
      if (customerFcm.rows[0]?.fcm_token) {
        const providerName = req.user.business_name || req.user.name;
        const priceFormatted = `RD$${parseFloat(amount).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`;
        FirebaseService.sendNotification(
          customerFcm.rows[0].fcm_token,
          '✅ Pedido aceptado',
          `${providerName} aceptó tu pedido y propone ${priceFormatted}. Revísalo y confirma.`,
          { type: 'request_accepted', requestId: id }
        ).catch(() => {});
        // Registrar en tabla de notificaciones
        db.query(
          `INSERT INTO notifications (user_id, title, body, type, request_id, created_at)
           VALUES ($1, 'Pedido aceptado', $2, 'request_accepted', $3, NOW())`,
          [request.customer_id, `${providerName} aceptó tu pedido y propone ${priceFormatted}`, id]
        ).catch(() => {});
      }
    }

    if (event_type === 'price_updated') {
      const newAmount = event_data.new_amount;
      await db.query(
        `UPDATE requests SET total_price = $1 WHERE id = $2`,
        [newAmount, id]
      );
      // Notificar al cliente que el precio fue actualizado
      const customerFcm = await db.query('SELECT fcm_token FROM users WHERE id = $1', [request.customer_id]);
      if (customerFcm.rows[0]?.fcm_token) {
        const providerName = req.user.business_name || req.user.name;
        const priceFormatted = `RD$${parseFloat(newAmount).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`;
        FirebaseService.sendNotification(
          customerFcm.rows[0].fcm_token,
          '💰 Precio actualizado',
          `${providerName} actualizó el precio a ${priceFormatted}. Revísalo y confirma.`,
          { type: 'request_accepted', requestId: id }
        ).catch(() => {});
      }
    }

    if (event_type === 'price_accepted') {
      const amount = event_data.amount;
      await db.query(
        `UPDATE requests SET total_price = $1, status = 'assigned' WHERE id = $2`,
        [amount, id]
      );
      // Notificar al proveedor que el cliente aceptó
      const providerFcm = await db.query('SELECT fcm_token FROM users WHERE id = $1', [request.provider_id]);
      if (providerFcm.rows[0]?.fcm_token) {
        const customerName = req.user.name;
        const priceFormatted = `RD$${parseFloat(amount).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`;
        FirebaseService.sendNotification(
          providerFcm.rows[0].fcm_token,
          '🎉 Precio aceptado',
          `${customerName} aceptó el precio de ${priceFormatted}. Procede con el pedido.`,
          { type: 'price_accepted', requestId: id }
        ).catch(() => {});
      }
    }

    if (event_type === 'price_rejected') {
      await db.query(
        `UPDATE requests SET status = 'pending', total_price = NULL WHERE id = $1`,
        [id]
      );
      // Notificar al proveedor que el cliente rechazó
      const providerFcm = await db.query('SELECT fcm_token FROM users WHERE id = $1', [request.provider_id]);
      if (providerFcm.rows[0]?.fcm_token) {
        const customerName = req.user.name;
        FirebaseService.sendNotification(
          providerFcm.rows[0].fcm_token,
          '❌ Precio rechazado',
          `${customerName} rechazó el precio. Puedes proponer uno nuevo.`,
          { type: 'price_rejected', requestId: id }
        ).catch(() => {});
      }
    }

    res.status(201).json({
      success: true,
      message: 'Evento registrado',
      event_id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });
    
  } catch (error) {
    console.error('Error en addRequestEvent:', error);
    res.status(500).json({ error: error.message });
  }
};
// Obtener timeline de eventos de un pedido
const getRequestTimeline = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  
  try {
    // Verificar que el usuario tiene acceso al pedido
    const accessResult = await db.query(
      `SELECT customer_id, provider_id, total_price FROM requests WHERE id = $1`,
      [id]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    const request = accessResult.rows[0];
    const hasAccess = request.customer_id === userId || request.provider_id === userId;
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'No tienes acceso a este pedido' });
    }
    
    // Obtener timeline
    const events = await db.query(
      `SELECT 
         e.id,
         e.event_type, 
         e.event_data, 
         e.created_at,
         u.name as created_by_name,
         u.role as created_by_role
       FROM request_events e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.request_id = $1
       ORDER BY e.created_at ASC`,
      [id]
    );
    
    // Obtener estado actual calculado
    const statusResult = await db.query(
      `SELECT get_request_current_status($1) as current_status`,
      [id]
    );
    
    res.json({
      request_id: id,
      current_status: statusResult.rows[0].current_status,
      total_price: request.total_price,
      events: events.rows
    });
    
  } catch (error) {
    console.error('Error en getRequestTimeline:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener últimos eventos de un pedido (para polling)
const getRecentEvents = async (req, res) => {
  const { id } = req.params;
  const { since } = req.query;
  const userId = req.user.id;
  
  try {
    // Verificar acceso
    const accessResult = await db.query(
      `SELECT customer_id, provider_id FROM requests WHERE id = $1`,
      [id]
    );
    
    if (accessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    const request = accessResult.rows[0];
    const hasAccess = request.customer_id === userId || request.provider_id === userId;
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'No tienes acceso a este pedido' });
    }
    
    const query = `
      SELECT 
        e.id,
        e.event_type, 
        e.event_data, 
        e.created_at,
        u.name as created_by_name,
        u.role as created_by_role
      FROM request_events e
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.request_id = $1
        AND e.created_at > COALESCE($2, '1970-01-01')
      ORDER BY e.created_at ASC
    `;
    
    const events = await db.query(query, [id, since]);
    
    res.json({
      request_id: id,
      events: events.rows
    });
    
  } catch (error) {
    console.error('Error en getRecentEvents:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  addRequestEvent,
  getRequestTimeline,
  getRecentEvents
};