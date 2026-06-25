const db = require('../config/database');

const submitReport = async (req, res) => {
  const reporterId = req.user.id;
  const { reported_user_id, request_id, reason, description } = req.body;

  if (!reported_user_id || !reason) {
    return res.status(400).json({ error: 'reported_user_id y reason son requeridos.' });
  }

  if (reporterId === reported_user_id) {
    return res.status(400).json({ error: 'No puedes reportarte a ti mismo.' });
  }

  await db.query(
    `INSERT INTO reports (reporter_id, reported_user_id, request_id, reason, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [reporterId, reported_user_id, request_id || null, reason, description || null]
  );

  res.status(201).json({ message: 'Reporte enviado correctamente.' });
};

module.exports = { submitReport };
