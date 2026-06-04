const db = require('../config/database');

const requireSubscription = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT subscription_active, subscription_expires_at 
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    
    const user = result.rows[0];
    
    if (!user || !user.subscription_active) {
      return res.status(403).json({ 
        error: 'Active subscription required',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }
    
    if (user.subscription_expires_at && new Date(user.subscription_expires_at) < new Date()) {
      await db.query(
        'UPDATE users SET subscription_active = false WHERE id = $1',
        [req.user.id]
      );
      return res.status(403).json({ 
        error: 'Subscription expired',
        code: 'SUBSCRIPTION_EXPIRED'
      });
    }
    
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { requireSubscription };