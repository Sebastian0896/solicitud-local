const { pool } = require('../config/database');

const createSuggestion = async (req, res) => {
  const userId = req.user.id;
  const { message } = req.body;

  if (!message || message.trim().length < 5) {
    return res.status(400).json({ error: 'La sugerencia debe tener al menos 5 caracteres.' });
  }
  if (message.trim().length > 1000) {
    return res.status(400).json({ error: 'La sugerencia no puede superar los 1000 caracteres.' });
  }

  try {
    await pool.query(
      'INSERT INTO suggestions (user_id, message) VALUES ($1, $2)',
      [userId, message.trim()]
    );
    res.status(201).json({ message: '¡Gracias por tu sugerencia!' });
  } catch (err) {
    console.error('createSuggestion error:', err);
    res.status(500).json({ error: 'Error al guardar la sugerencia.' });
  }
};

const getSuggestions = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.message, s.created_at,
              u.name, u.email, u.role
       FROM suggestions s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC
       LIMIT 200`
    );
    res.json({ suggestions: rows });
  } catch (err) {
    console.error('getSuggestions error:', err);
    res.status(500).json({ error: 'Error al obtener sugerencias.' });
  }
};

module.exports = { createSuggestion, getSuggestions };
