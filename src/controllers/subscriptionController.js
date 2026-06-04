const db = require('../config/database');

const activateSubscription = async (req, res) => {
  const userId = req.user.id;
  const { paymentMethod, transactionId } = req.body;
  
  try {
    if (req.user.role !== 'provider') {
      return res.status(403).json({ error: 'Only providers can have subscriptions' });
    }
    
    const result = await db.query(
      `UPDATE users 
       SET subscription_active = true,
           subscription_expires_at = NOW() + INTERVAL '30 days'
       WHERE id = $1 AND role = 'provider'
       RETURNING id, subscription_active, subscription_expires_at`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await db.query(
      `INSERT INTO subscription_payments (user_id, payment_method, transaction_id, amount, currency, status)
       VALUES ($1, $2, $3, 299, 'DOP', 'active')`,
      [userId, paymentMethod || 'manual', transactionId || null]
    );
    
    res.json({
      success: true,
      message: 'Subscription activated for 30 days',
      expires_at: result.rows[0].subscription_expires_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const checkSubscription = async (req, res) => {
  const userId = req.user.id;
  
  try {
    const result = await db.query(
      `SELECT subscription_active, subscription_expires_at,
              CASE 
                WHEN subscription_expires_at < NOW() THEN 'expired'
                WHEN subscription_active = true THEN 'active'
                ELSE 'inactive'
              END as status
       FROM users WHERE id = $1`,
      [userId]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { activateSubscription, checkSubscription };