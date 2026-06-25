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

  const { error } = await db
    .from('reports')
    .insert({
      reporter_id: reporterId,
      reported_user_id,
      request_id: request_id || null,
      reason,
      description: description || null,
    });

  if (error) {
    console.error('[submitReport] Error:', error);
    return res.status(500).json({ error: 'No se pudo enviar el reporte.' });
  }

  res.status(201).json({ message: 'Reporte enviado correctamente.' });
};

module.exports = { submitReport };
