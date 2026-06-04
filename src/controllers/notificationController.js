// src/controllers/notificationController.js (nuevo archivo)
const db = require('../config/database');

const getNotifications = async (req, res) => {
  const userId = req.user.id;
  
  try {
    const result = await db.query(
      `SELECT id, title, body, type, is_read, created_at
       FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const markAsRead = async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user.id;
  
  try {
    await db.query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const markAllAsRead = async (req, res) => {
  const userId = req.user.id;
  
  try {
    await db.query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead };