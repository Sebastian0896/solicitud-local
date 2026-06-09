
const db = require('../../config/database');

// Marcar pedido como eliminado (soft delete)
const deleteRequest = async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;
  
  try {
    // Verificar que el pedido existe, es del cliente y no está en estado activo
    const checkResult = await db.query(
      `SELECT status FROM requests 
       WHERE id = $1 AND customer_id = $2 AND is_deleted = false`,
      [requestId, userId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    const currentStatus = checkResult.rows[0].status;
    
    // No permitir eliminar pedidos que están en proceso
    const activeStatuses = ['assigned', 'on_the_way', 'waiting_confirmation'];
    if (activeStatuses.includes(currentStatus)) {
      return res.status(400).json({ 
        error: 'No se puede eliminar un pedido en proceso' 
      });
    }
    
    // Soft delete
    await db.query(
      `UPDATE requests 
       SET is_deleted = true 
       WHERE id = $1 AND customer_id = $2`,
      [requestId, userId]
    );
    
    res.json({ success: true, message: 'Pedido eliminado' });
    
  } catch (error) {
    console.error('Error delete request:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = deleteRequest;