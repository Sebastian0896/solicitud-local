const db = require('../../config/database');
const FirebaseService = require('../../services/firebaseService');

const createRequest = async (req, res) => {
  const { 
    request_text, 
    category_id,  // <-- NUEVO
    lat, 
    lng 
  } = req.body;
  
  const customerId = req.user.id;
  const customerName = req.user.name;
  const customerPhone = req.user.phone;
  
  // Validar que category_id existe
  if (!category_id) {
    return res.status(400).json({ error: 'Debes seleccionar una categoría' });
  }
  
  try {
    // Verificar que la categoría existe y está activa
    const catCheck = await db.query(
      `SELECT id FROM categories WHERE id = $1 AND is_active = true`,
      [category_id]
    );
    
    if (catCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Categoría inválida o inactiva' });
    }
    
    const result = await db.query(
      `INSERT INTO requests 
       (id, customer_id, request_text, status, customer_name, customer_phone, created_at, category_id, customer_location)
       VALUES (gen_random_uuid(), $1, $2, 'pending', $3, $4, NOW(), $5, ST_SetSRID(ST_MakePoint($6, $7), 4326))
       RETURNING id`,
      [customerId, request_text, customerName, customerPhone, category_id, lng, lat]
    );
    
    res.status(201).json({
      success: true,
      message: 'Pedido creado exitosamente',
      requestId: result.rows[0].id
    });
    
  } catch (error) {
    console.error('Error en createRequest:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = createRequest;