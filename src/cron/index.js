const cron = require('node-cron');
const db = require('../config/database');
const FirebaseService = require('../services/firebaseService');
const logger = require('../utils/logger');

// Recordatorio de suscripción — todos los días a las 9am
// Avisa a proveedores cuya suscripción vence en 3 días o ya venció
cron.schedule('0 9 * * *', async () => {
  logger.info('[cron] Verificando suscripciones próximas a vencer...');
  try {
    const result = await db.query(
      `SELECT id, name, fcm_token, subscription_expires_at,
              (subscription_expires_at < NOW()) AS already_expired
       FROM users
       WHERE role = 'provider'
         AND is_active = true
         AND fcm_token IS NOT NULL
         AND subscription_expires_at IS NOT NULL
         AND subscription_expires_at BETWEEN NOW() - INTERVAL '1 day' AND NOW() + INTERVAL '3 days'`
    );

    for (const provider of result.rows) {
      const alreadyExpired = provider.already_expired;
      const title = alreadyExpired ? '⚠️ Suscripción vencida' : '⏰ Tu suscripción vence pronto';
      const body = alreadyExpired
        ? 'Tu suscripción venció. Renuévala para seguir aceptando pedidos.'
        : 'Tu suscripción vence en menos de 3 días. ¡Renuévala ahora!';

      await FirebaseService.sendNotification(provider.fcm_token, title, body, {
        type: 'subscription_reminder',
      });

      await db.query(
        `INSERT INTO notifications (user_id, title, body, type, created_at)
         VALUES ($1, $2, $3, 'subscription_reminder', NOW())
         ON CONFLICT DO NOTHING`,
        [provider.id, title, body]
      );
    }

    logger.info(`[cron] Recordatorios enviados: ${result.rows.length}`);
  } catch (err) {
    logger.error('[cron] Error en recordatorio de suscripción:', err.message);
  }
});

// Purga de notificaciones — todos los días a medianoche
// Elimina definitivamente las soft-deleted o con más de 30 días
cron.schedule('0 0 * * *', async () => {
  logger.info('[cron] Purgando notificaciones antiguas...');
  try {
    const result = await db.query(
      `DELETE FROM notifications
       WHERE deleted_at IS NOT NULL
          OR created_at < NOW() - INTERVAL '30 days'`
    );
    logger.info(`[cron] Notificaciones purgadas: ${result.rowCount}`);
  } catch (err) {
    logger.error('[cron] Error en purga de notificaciones:', err.message);
  }
});

logger.info('[cron] Jobs registrados: recordatorio suscripción (9am), purga notificaciones (00:00)');
