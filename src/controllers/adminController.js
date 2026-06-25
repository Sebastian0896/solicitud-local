const db = require('../config/database');

// Dashboard - Estadísticas generales
const getStats = async (req, res) => {
  try {
    // Total de usuarios
    const totalUsers = await db.query(
      'SELECT COUNT(*) as count FROM users'
    );
    
    // Total de clientes
    const totalCustomers = await db.query(
      'SELECT COUNT(*) as count FROM users WHERE role = $1',
      ['customer']
    );
    
    // Total de proveedores
    const totalProviders = await db.query(
      'SELECT COUNT(*) as count FROM users WHERE role = $1',
      ['provider']
    );
    
    // Proveedores activos (con suscripción)
    const activeProviders = await db.query(
      'SELECT COUNT(*) as count FROM users WHERE role = $1 AND subscription_active = true AND available = true',
      ['provider']
    );
    
    // Pedidos hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const ordersToday = await db.query(
      'SELECT COUNT(*) as count FROM requests WHERE created_at >= $1',
      [today]
    );
    
    // Pedidos completados este mes
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const completedThisMonth = await db.query(
      'SELECT COUNT(*) as count FROM requests WHERE status = $1 AND completed_at >= $2',
      ['delivered', startOfMonth]
    );
    
    // Pedidos pendientes
    const pendingOrders = await db.query(
      'SELECT COUNT(*) as count FROM requests WHERE status = $1',
      ['pending']
    );
    
    // Ingresos por suscripciones (estimado)
    const subscriptionsRevenue = await db.query(
      'SELECT COUNT(*) as count FROM users WHERE role = $1 AND subscription_active = true',
      ['provider']
    );
    
    // Calificación promedio de proveedores
    const avgRating = await db.query(
      'SELECT AVG(rating) as avg FROM ratings'
    );
    
    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      totalCustomers: parseInt(totalCustomers.rows[0].count),
      totalProviders: parseInt(totalProviders.rows[0].count),
      activeProviders: parseInt(activeProviders.rows[0].count),
      ordersToday: parseInt(ordersToday.rows[0].count),
      completedThisMonth: parseInt(completedThisMonth.rows[0].count),
      pendingOrders: parseInt(pendingOrders.rows[0].count),
      estimatedRevenue: parseInt(subscriptionsRevenue.rows[0].count) * 299,
      avgRating: parseFloat(avgRating.rows[0].avg) || 0,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener todos los usuarios
const getUsers = async (req, res) => {
  const { role, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    let query = `
      SELECT id, email, name, phone, role, business_name, is_active, 
             subscription_active, available, created_at
      FROM users WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (role && role !== 'all') {
      query += ` AND role = $${paramIndex++}`;
      params.push(role);
    }
    
    if (search) {
      query += ` AND (email ILIKE $${paramIndex++} OR name ILIKE $${paramIndex++} OR business_name ILIKE $${paramIndex++})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    
    // Obtener total de registros
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    const countParams = [];
    let countIndex = 1;
    
    if (role && role !== 'all') {
      countQuery += ` AND role = $${countIndex++}`;
      countParams.push(role);
    }
    
    if (search) {
      countQuery += ` AND (email ILIKE $${countIndex++} OR name ILIKE $${countIndex++} OR business_name ILIKE $${countIndex++})`;
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    const totalResult = await db.query(countQuery, countParams);
    
    res.json({
      users: result.rows,
      total: parseInt(totalResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Activar/desactivar usuario
const toggleUserStatus = async (req, res) => {
  const { userId } = req.params;
  const { isActive } = req.body;
  
  try {
    const result = await db.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, name, is_active',
      [isActive, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      success: true,
      user: result.rows[0],
      message: isActive ? 'User activated' : 'User deactivated',
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener todos los pedidos
const getRequests = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    let query = `
      SELECT r.id, r.request_text, r.status, r.customer_name, r.provider_name, 
             r.created_at, r.assigned_at, r.completed_at,
             u.name as customer_email
      FROM requests r
      LEFT JOIN users u ON r.customer_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (status && status !== 'all') {
      query += ` AND r.status = $${paramIndex++}`;
      params.push(status);
    }
    
    query += ` ORDER BY r.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    
    // Total de registros
    let countQuery = 'SELECT COUNT(*) as total FROM requests WHERE 1=1';
    const countParams = [];
    let countIndex = 1;
    
    if (status && status !== 'all') {
      countQuery += ` AND status = $${countIndex++}`;
      countParams.push(status);
    }
    
    const totalResult = await db.query(countQuery, countParams);
    
    res.json({
      requests: result.rows,
      total: parseInt(totalResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Cancelar pedido (admin)
const cancelRequest = async (req, res) => {
  const { requestId } = req.params;
  
  try {
    const result = await db.query(
      'UPDATE requests SET status = $1 WHERE id = $2 RETURNING id, status',
      ['cancelled', requestId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    res.json({
      success: true,
      message: 'Request cancelled',
      request: result.rows[0],
    });
  } catch (error) {
    console.error('Cancel request error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener suscripciones

const getSubscriptions = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.name, u.email, u.business_name, 
             u.subscription_active, u.subscription_expires_at,
             COALESCE(sp.payment_method, 'manual') as payment_method,
             COALESCE(sp.amount, 299) as amount,
             sp.created_at as payment_date
      FROM users u
      LEFT JOIN subscription_payments sp ON u.id = sp.user_id
      WHERE u.role = 'provider'
      ORDER BY u.subscription_expires_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Reporte de pedidos por día (gráfico)
const getOrdersReport = async (req, res) => {
  const { days = 7 } = req.query;
  
  try {
    const result = await db.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as completed
      FROM requests
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get orders report error:', error);
    res.status(500).json({ error: error.message });
  }
};

const getReports = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const { data, error } = await db
      .from('reports')
      .select(`
        id, reason, description, created_at,
        reporter:reporter_id ( id, name, email ),
        reported:reported_user_id ( id, name, email, role ),
        request:request_id ( id, request_text )
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getStats,
  getUsers,
  toggleUserStatus,
  getRequests,
  cancelRequest,
  getSubscriptions,
  getOrdersReport,
  getReports,
};