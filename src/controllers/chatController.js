const db = require('../config/database');

// Enviar mensaje
const sendMessage = async (req, res) => {
  const { requestId } = req.params;
  const { message } = req.body;
  const senderId = req.user.id;
  
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  }
  
  try {
    // 👈 Convertir IDs a texto en la consulta SQL
    const requestCheck = await db.query(
      `SELECT 
         customer_id::text as customer_id_text, 
         provider_id::text as provider_id_text 
       FROM requests 
       WHERE id = $1`,
      [requestId]
    );
    
    if (requestCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const request = requestCheck.rows[0];
    const isCustomer = request.customer_id_text === senderId;
    const isProvider = request.provider_id_text === senderId;
    
    if (!isCustomer && !isProvider) {
      return res.status(403).json({ error: 'No tienes acceso a este chat' });
    }
    
    // Guardar mensaje
    const result = await db.query(
      `INSERT INTO chat_messages (request_id, sender_id, message)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [requestId, senderId, message]
    );
    
    const newMessage = await db.query(
      `SELECT * FROM chat_messages_with_sender WHERE id = $1`,
      [result.rows[0].id]
    );
    
    res.status(201).json({
      success: true,
      message: newMessage.rows[0]
    });
    
  } catch (error) {
    console.error('Error en sendMessage:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener mensajes de un pedido
const getMessages = async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;
  const { limit = 50, before } = req.query;
  
  try {
    // Verificar acceso
    const requestCheck = await db.query(
      `SELECT customer_id, provider_id FROM requests WHERE id = $1`,
      [requestId]
    );
    
    if (requestCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    const request = requestCheck.rows[0];
    const isCustomer = request.customer_id === userId;
    const isProvider = request.provider_id === userId;
    
    if (!isCustomer && !isProvider) {
      return res.status(403).json({ error: 'No tienes acceso a este chat' });
    }
    
    const { since } = req.query;

    // Construir query con paginación / polling incremental
    let query = `
      SELECT * FROM chat_messages_with_sender
      WHERE request_id = $1
    `;
    const queryParams = [requestId];

    if (since) {
      // Polling incremental: solo mensajes posteriores a 'since'
      query += ` AND created_at > $${queryParams.length + 1}`;
      queryParams.push(since);
      query += ` ORDER BY created_at ASC`;
    } else if (before) {
      query += ` AND created_at < $${queryParams.length + 1}`;
      queryParams.push(before);
      query += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1}`;
      queryParams.push(limit);
    }
    
    const result = await db.query(query, queryParams);
    
    // Si se usó DESC (sin since), revertir para orden ascendente
    const messages = since ? result.rows : result.rows.reverse();

    res.json({
      request_id: requestId,
      messages,
    });
    
  } catch (error) {
    console.error('Error en getMessages:', error);
    res.status(500).json({ error: error.message });
  }
};

// Marcar mensajes como leídos
const markAsRead = async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;
  
  try {
    await db.query(
      `UPDATE chat_messages 
       SET is_read = true 
       WHERE request_id = $1 
         AND sender_id != $2 
         AND is_read = false`,
      [requestId, userId]
    );
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error en markAsRead:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener últimos mensajes no leídos (para notificaciones)
const getUnreadCount = async (req, res) => {
  const userId = req.user.id;
  
  try {
    // Para proveedor: mensajes en pedidos donde es provider
    // Para cliente: mensajes en pedidos donde es customer
    const result = await db.query(
      `SELECT 
         r.id as request_id,
         COUNT(cm.id) as unread_count,
         r.request_text
       FROM requests r
       JOIN chat_messages cm ON cm.request_id = r.id
       WHERE (r.customer_id = $1 OR r.provider_id = $1)
         AND cm.sender_id != $1
         AND cm.is_read = false
       GROUP BY r.id, r.request_text`,
      [userId]
    );
    
    res.json({ unread: result.rows });
    
  } catch (error) {
    console.error('Error en getUnreadCount:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCount
};