const db = require('../config/database');
const { createCardNetSession, verifyWebhookSignature } = require('../services/paymentService');

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

/** Genera un ID de orden único con prefijo SL- */
const generateOrderId = (userId) =>
  `SL-${userId}-${Date.now()}`;

/** Activa la suscripción de un usuario por 30 días y registra el pago. */
const _activateSubscriptionInDb = async (userId, { paymentMethod, transactionId, amount, orderId }) => {
  const result = await db.query(
    `UPDATE users
     SET subscription_active     = true,
         subscription_expires_at = NOW() + INTERVAL '30 days'
     WHERE id = $1 AND role = 'provider'
     RETURNING id, subscription_active, subscription_expires_at`,
    [userId]
  );

  if (result.rows.length === 0) return null;

  await db.query(
    `INSERT INTO subscription_payments
       (user_id, payment_method, transaction_id, amount, currency, status)
     VALUES ($1, $2, $3, $4, 'DOP', 'active')
     ON CONFLICT DO NOTHING`,
    [userId, paymentMethod || 'cardnet', transactionId || orderId, amount || 299]
  );

  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Controladores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/subscriptions/pay
 * Inicia una sesión de pago con CardNet y devuelve la URL de la
 * página de pago alojada por Azul.
 */
const createPaymentSession = async (req, res) => {
  const userId = req.user.id;

  if (req.user.role !== 'provider') {
    return res.status(403).json({ error: 'Solo los proveedores pueden suscribirse.' });
  }

  try {
    // Verificar si ya tiene suscripción activa
    const sub = await db.query(
      `SELECT subscription_active, subscription_expires_at FROM users WHERE id = $1`,
      [userId]
    );
    const user = sub.rows[0];
    if (user?.subscription_active && new Date(user.subscription_expires_at) > new Date()) {
      return res.status(409).json({ error: 'Ya tienes una suscripción activa.' });
    }

    const orderId = generateOrderId(userId);
    const { paymentUrl, azulOrderId } = await createCardNetSession({ userId, orderId });

    // Guardar el intent de pago para validarlo en el webhook
    await db.query(
      `INSERT INTO subscription_payments
         (user_id, payment_method, transaction_id, amount, currency, status)
       VALUES ($1, 'cardnet', $2, 299, 'DOP', 'pending')`,
      [userId, orderId]
    );

    res.json({ paymentUrl, orderId: azulOrderId });
  } catch (error) {
    console.error('[subscription] createPaymentSession error:', error.message);
    res.status(502).json({ error: error.message });
  }
};

/**
 * POST /api/subscriptions/cardnet/webhook
 * CardNet llama a este endpoint cuando el pago se procesa (éxito o fallo).
 * NO requiere autenticación JWT — usa verificación HMAC.
 */
const cardnetWebhook = async (req, res) => {
  const signature = req.headers['x-azul-signature'] || req.headers['x-cardnet-signature'] || '';

  if (!verifyWebhookSignature(req.body, signature)) {
    console.warn('[CardNet webhook] Firma inválida');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const {
    OrderNumber: orderId,
    ResponseCode,
    AzulOrderId,
    CustomField2: userId,      // userId que guardamos al crear la sesión
    Amount,
  } = req.body;

  console.log(`[CardNet webhook] orderId=${orderId} code=${ResponseCode} userId=${userId}`);

  // CardNet usa '00' como código de éxito
  if (ResponseCode !== '00') {
    // Marcar el pago como fallido
    await db.query(
      `UPDATE subscription_payments SET status = 'failed' WHERE transaction_id = $1`,
      [orderId]
    ).catch(() => {});
    return res.json({ received: true });
  }

  try {
    const activated = await _activateSubscriptionInDb(userId, {
      paymentMethod: 'cardnet',
      transactionId: AzulOrderId || orderId,
      amount: Amount ? parseInt(Amount) / 100 : 299,
      orderId,
    });

    if (!activated) {
      console.error(`[CardNet webhook] Usuario ${userId} no encontrado`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[CardNet webhook] Error activando suscripción:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/subscriptions/cardnet/return
 * Azul redirige al navegador aquí tras el pago.
 * La app Flutter intercepta esta URL en el WebView para saber el resultado.
 *
 * El WebView en Flutter monitorea navegaciones a esta URL —
 * no es una API real, solo un punto de intercepción.
 */
const cardnetReturn = async (req, res) => {
  const { status, orderId, userId } = req.query;

  if (status === 'approved') {
    // Intentar activar en caso de que el webhook llegue tarde
    try {
      await _activateSubscriptionInDb(userId, {
        paymentMethod: 'cardnet',
        orderId,
        amount: 299,
      });
    } catch (_) { /* el webhook es la fuente primaria */ }
  }

  // Respuesta mínima — Flutter la intercepta antes de que se renderice
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><meta charset="utf-8"><title>Solicitud Local</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
        ${status === 'approved'
          ? '<h2>✅ ¡Pago exitoso!</h2><p>Volviendo a la app...</p>'
          : '<h2>❌ Pago no completado</h2><p>Volviendo a la app...</p>'}
      </body>
    </html>
  `);
};

/**
 * POST /api/subscriptions/activate  (legado / activación manual por admin)
 */
const activateSubscription = async (req, res) => {
  const userId = req.user.id;
  const { paymentMethod, transactionId } = req.body;

  try {
    if (req.user.role !== 'provider') {
      return res.status(403).json({ error: 'Only providers can have subscriptions' });
    }

    const activated = await _activateSubscriptionInDb(userId, {
      paymentMethod: paymentMethod || 'manual',
      transactionId,
      amount: 299,
    });

    if (!activated) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Subscription activated for 30 days',
      expires_at: activated.subscription_expires_at,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/subscriptions/status
 */
const checkSubscription = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT subscription_active, subscription_expires_at,
              CASE
                WHEN subscription_expires_at < NOW() THEN 'expired'
                WHEN subscription_active = true       THEN 'active'
                ELSE 'inactive'
              END AS status
       FROM users WHERE id = $1`,
      [userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createPaymentSession,
  cardnetWebhook,
  cardnetReturn,
  activateSubscription,
  checkSubscription,
};
