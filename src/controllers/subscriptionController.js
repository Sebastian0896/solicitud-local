const db = require('../config/database');
const { createCheckout, verifyWebhookSignature, cancelSubscription, resumeSubscription } = require('../services/lemonSqueezyService');

// ─── helpers ─────────────────────────────────────────────────────────────────

const _activateSubscription = async (userId, { transactionId, expiresAt, lsSubId, portalUrl }) => {
  const expiry = expiresAt
    ? `'${expiresAt}'::timestamptz`
    : `NOW() + INTERVAL '30 days'`;

  const result = await db.query(
    `UPDATE users
     SET subscription_active       = true,
         subscription_expires_at   = ${expiry},
         ls_subscription_id        = COALESCE($2, ls_subscription_id),
         ls_customer_portal_url    = COALESCE($3, ls_customer_portal_url)
     WHERE id = $1 AND role = 'provider'
     RETURNING id, subscription_active, subscription_expires_at`,
    [userId, lsSubId || null, portalUrl || null]
  );

  if (result.rows.length === 0) return null;

  await db.query(
    `INSERT INTO subscription_payments
       (user_id, payment_method, transaction_id, amount, currency, status)
     VALUES ($1, 'lemonsqueezy', $2, 299, 'USD', 'active')`,
    [userId, transactionId]
  ).catch(() => {});

  return result.rows[0];
};

const _deactivateSubscription = async (userId) => {
  await db.query(
    `UPDATE users SET subscription_active = false WHERE id = $1 AND role = 'provider'`,
    [userId]
  );
};

// ─── controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/subscriptions/checkout
 */
const createCheckoutSession = async (req, res) => {
  const userId = req.user.id;

  if (req.user.role !== 'provider') {
    return res.status(403).json({ error: 'Solo los proveedores pueden suscribirse.' });
  }

  try {
    const sub = await db.query(
      `SELECT subscription_active, subscription_expires_at, email FROM users WHERE id = $1`,
      [userId]
    );
    const user = sub.rows[0];

    if (user?.subscription_active && new Date(user.subscription_expires_at) > new Date()) {
      return res.status(409).json({ error: 'Ya tienes una suscripción activa.' });
    }

    const checkoutUrl = await createCheckout({ userId, userEmail: user?.email });
    res.json({ checkoutUrl });
  } catch (error) {
    console.error('[subscription] createCheckoutSession error:', error.message);
    res.status(502).json({ error: error.message });
  }
};

/**
 * POST /api/subscriptions/ls/webhook
 */
const lsWebhook = async (req, res) => {
  const sig = req.headers['x-signature'] || '';
  const rawBody = req.rawBody;

  if (!rawBody || !verifyWebhookSignature(rawBody, sig)) {
    console.warn('[LS webhook] Firma inválida');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { meta, data } = req.body;
  const eventName = meta?.event_name;
  const userId = meta?.custom_data?.user_id;

  console.log(`[LS webhook] event=${eventName} userId=${userId}`);

  if (!userId) return res.json({ received: true });

  try {
    const attrs = data?.attributes || {};
    const txId = `ls_${eventName}_${data?.id || Date.now()}`;
    const lsSubId = data?.id ? String(data.id) : null;
    const portalUrl = attrs.urls?.customer_portal || null;

    switch (eventName) {

      case 'subscription_created':
      case 'subscription_resumed':
      case 'subscription_unpaused': {
        await _activateSubscription(userId, {
          transactionId: txId,
          expiresAt: attrs.renews_at || null,
          lsSubId,
          portalUrl,
        });
        console.log(`[LS] Activada (${eventName}) userId=${userId} hasta ${attrs.renews_at}`);
        break;
      }

      case 'subscription_payment_success':
      case 'subscription_payment_recovered': {
        await _activateSubscription(userId, {
          transactionId: txId,
          expiresAt: attrs.renews_at || null,
          lsSubId,
          portalUrl,
        });
        console.log(`[LS] Renovada/recuperada userId=${userId} hasta ${attrs.renews_at}`);
        break;
      }

      case 'subscription_cancelled':
        console.log(`[LS] Cancelada (activa hasta ${attrs.ends_at}) userId=${userId}`);
        break;

      case 'subscription_paused':
        console.log(`[LS] Pausada userId=${userId}`);
        break;

      case 'subscription_payment_failed':
        console.log(`[LS] Pago fallido userId=${userId} — LS reintentará`);
        break;

      case 'subscription_expired':
      case 'order_refunded': {
        await _deactivateSubscription(userId);
        console.log(`[LS] Desactivada (${eventName}) userId=${userId}`);
        break;
      }

      default:
        console.log(`[LS] Evento ignorado: ${eventName}`);
    }
  } catch (error) {
    console.error('[LS webhook] Error:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ received: true });
};

/**
 * GET /api/subscriptions/ls/return
 */
const lsReturn = (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>QuikoYA Pro</title>
        <style>
          body { font-family: sans-serif; text-align: center; padding: 60px 24px;
                 background: #f0fdf4; color: #166534; }
          h2 { font-size: 22px; margin-bottom: 8px; }
          p  { font-size: 14px; color: #555; }
        </style>
      </head>
      <body>
        <h2>✅ ¡Suscripción activada!</h2>
        <p>Volviendo a la app...</p>
      </body>
    </html>
  `);
};

/**
 * GET /api/subscriptions/manage
 * Devuelve status, próximo cobro, portal URL e historial de pagos.
 */
const getManagement = async (req, res) => {
  const userId = req.user.id;
  try {
    const userResult = await db.query(
      `SELECT subscription_active, subscription_expires_at,
              ls_customer_portal_url,
              CASE
                WHEN subscription_expires_at < NOW() THEN 'expired'
                WHEN subscription_active = true       THEN 'active'
                ELSE 'inactive'
              END AS status
       FROM users WHERE id = $1`,
      [userId]
    );

    const paymentsResult = await db.query(
      `SELECT transaction_id, amount, currency, status, created_at
       FROM subscription_payments
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 12`,
      [userId]
    );

    res.json({
      ...userResult.rows[0],
      payments: paymentsResult.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/subscriptions/activate  (manual / admin)
 */
const activateSubscription = async (req, res) => {
  const userId = req.user.id;
  const { transactionId } = req.body;

  try {
    if (req.user.role !== 'provider') {
      return res.status(403).json({ error: 'Only providers can have subscriptions' });
    }

    const activated = await _activateSubscription(userId, {
      transactionId: transactionId || `manual_${Date.now()}`,
      expiresAt: null,
    });

    if (!activated) return res.status(404).json({ error: 'User not found' });

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

/**
 * POST /api/subscriptions/cancel
 * Cancela la suscripción del proveedor al final del período (no de inmediato).
 */
const cancelSubscriptionHandler = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT ls_subscription_id FROM users WHERE id = $1 AND role = 'provider'`,
      [userId]
    );
    const lsSubId = rows[0]?.ls_subscription_id;
    if (!lsSubId) {
      return res.status(400).json({ error: 'No hay suscripción activa para cancelar.' });
    }

    await cancelSubscription(lsSubId);

    res.json({ success: true, message: 'Suscripción cancelada. Permanece activa hasta el fin del período.' });
  } catch (error) {
    console.error('[cancel] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/subscriptions/resume
 * Reactiva una suscripción cancelada (antes de que expire).
 */
const resumeSubscriptionHandler = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT ls_subscription_id FROM users WHERE id = $1 AND role = 'provider'`,
      [userId]
    );
    const lsSubId = rows[0]?.ls_subscription_id;
    if (!lsSubId) {
      return res.status(400).json({ error: 'No hay suscripción para reactivar.' });
    }

    await resumeSubscription(lsSubId);

    res.json({ success: true, message: 'Suscripción reactivada.' });
  } catch (error) {
    console.error('[resume] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/subscriptions/open
 * Redirige a quikoya://subscription (deep link para el email de LS).
 * LS solo acepta https://, así que la URL del email apunta aquí.
 */
const openDeepLink = (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Abriendo QuikoYA...</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 60px 24px;
           background: #f0fdf4; color: #166534; }
    h2 { font-size: 20px; margin-bottom: 8px; }
    p  { color: #4b5563; font-size: 14px; }
  </style>
  <script>
    window.location = 'quikoya://subscription';
    setTimeout(function() {
      document.getElementById('msg').style.display = 'block';
    }, 1500);
  </script>
</head>
<body>
  <h2>Abriendo QuikoYA Pro...</h2>
  <div id="msg" style="display:none">
    <p>Si la app no abre automáticamente, ábrela manualmente y ve a <strong>Ajustes → Suscripción</strong>.</p>
  </div>
</body>
</html>`);
};

module.exports = {
  createCheckoutSession,
  lsWebhook,
  lsReturn,
  openDeepLink,
  cancelSubscriptionHandler,
  resumeSubscriptionHandler,
  getManagement,
  activateSubscription,
  checkSubscription,
};
