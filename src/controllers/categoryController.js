const db = require('../config/database');

// Obtener todas las categorías activas
const getCategories = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, icon FROM categories WHERE is_active = true ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error en getCategories:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener categorías de un proveedor específico
const getProviderCategories = async (req, res) => {
  const providerId = req.params.providerId || req.user.id;
  
  try {
    const result = await db.query(
      `SELECT c.id, c.name, c.icon 
       FROM categories c
       JOIN provider_categories pc ON pc.category_id = c.id
       WHERE pc.provider_id = $1 AND c.is_active = true`,
      [providerId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error en getProviderCategories:', error);
    res.status(500).json({ error: error.message });
  }
};

// Asignar categorías a un proveedor
const assignCategoriesToProvider = async (req, res) => {
  const providerId = req.user.id;
  const { categoryIds } = req.body; // Array de números
  
  if (!Array.isArray(categoryIds)) {
    return res.status(400).json({ error: 'categoryIds debe ser un array' });
  }
  
  try {
    // Verificar que el usuario es proveedor
    const userCheck = await db.query(
      `SELECT role FROM users WHERE id = $1`,
      [providerId]
    );
    
    if (userCheck.rows.length === 0 || userCheck.rows[0].role !== 'provider') {
      return res.status(403).json({ error: 'Solo los proveedores pueden tener categorías' });
    }
    
    // Eliminar categorías existentes
    await db.query(`DELETE FROM provider_categories WHERE provider_id = $1`, [providerId]);
    
    // Insertar nuevas categorías
    if (categoryIds.length > 0) {
      const values = categoryIds.map((_, i) => `($1, $${i + 2})`).join(',');
      const queryParams = [providerId, ...categoryIds];
      
      await db.query(
        `INSERT INTO provider_categories (provider_id, category_id) VALUES ${values}`,
        queryParams
      );
    }
    
    res.json({
      success: true,
      message: 'Categorías actualizadas correctamente',
      categoryIds
    });
    
  } catch (error) {
    console.error('Error en assignCategoriesToProvider:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getCategories,
  getProviderCategories,
  assignCategoriesToProvider
};