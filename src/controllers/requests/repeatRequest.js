const db = require('../../config/database');

// Repetir pedido anterior (crear nuevo con los mismos datos)
// controllers/requestController.js

const repeatRequest = async (req, res) => {
  const { requestId } = req.params;
  const customerId = req.user.id;
  
  try {
    // Obtener pedido original (solo si no está eliminado)
    const oldRequest = await db.query(
      `SELECT id, request_text, customer_location, status, repeat_count
       FROM requests 
       WHERE id = $1 
         AND customer_id = $2 
         AND is_deleted = false`,
      [requestId, customerId]
    );
    
    if (oldRequest.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Pedido no encontrado o ha sido eliminado' 
      });
    }
    
    const request = oldRequest.rows[0];
    
    // Verificar si el pedido ya está activo (pending, waiting_confirmation, assigned)
    const activeStatuses = ['pending', 'waiting_confirmation', 'assigned', 'on_the_way'];
    if (activeStatuses.includes(request.status)) {
      return res.status(400).json({ 
        error: 'Ya tienes un pedido activo con estas características' 
      });
    }
    
    // Actualizar el pedido existente en lugar de crear uno nuevo
    const updatedRequest = await db.query(
      `UPDATE requests 
       SET status = 'pending',
           repeat_count = repeat_count + 1,
           last_repeated_at = NOW(),
           assigned_at = NULL,
           completed_at = NULL,
           provider_id = NULL,
           provider_name = NULL,
           total_price = NULL,
           is_deleted = false
       WHERE id = $1
       RETURNING id, repeat_count`,
      [requestId]
    );
    
    res.status(200).json({
      success: true,
      message: 'Pedido reactivado con éxito',
      requestId,
      repeatCount: updatedRequest.rows[0].repeat_count
    });
    
  } catch (error) {
    console.error('Error repeat request:', error);
    res.status(500).json({ error: error.message });
  }
};
module.exports =repeatRequest;