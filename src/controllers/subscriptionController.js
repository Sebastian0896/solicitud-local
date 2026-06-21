const db = require('../config/database');
const { createCheckout, verifyWebhookSignature } = require('../services/lemonSqueezyService');

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Activates a provider subscription and records the payment.
 * expiresAt: ISO string from Lemon Squeezy (renews_at) or null for +30 days.
 */
const _activateSubscription = async (userId, { transactionId, expiresAt }) => {
  const expiry = expiresAt
    ? `'${expiresAt}'::timestamptz`
    : `NOW() + INTERVAL '30 days'`;

  const result = await db.query(
    `UPDATE users
     SET subscription_active     = true,
         subscription_expires_at = ${expiry}
     WHERE id = $1 AND role = 'provider'
     RETURNING id, subscription_active, subscription_expires_at`,
    [userId]
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
    `UPDATE users
     SET subscription_active = false
     WHERE id = $1 AND role = 'provider'`,
    [userId]
  );
};

// ─── controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/subscriptions/checkout
 * Creates a Lemon Squeezy hosted checkout session and returns the URL.
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
 * Lemon Squeezy calls this endpoint after payment events.
 * No JWT auth — uses HMAC-SHA256 signature verification.
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

  if (!userId) {
    return res.json({ received: true });
  }

  try {
    const attrs = data?.attributes || {};
    const txId = `ls_${eventName}_${data?.id || Date.now()}`;

    switch (eventName) {

      // ── Activar ────────────────────────────────────────────────────────────
      case 'subscription_created':
      case 'subscription_resumed':
      case 'subscription_unpaused': {
        const expiresAt = attrs.renews_at || null;
        await _activateSubscription(userId, { transactionId: txId, expiresAt });
        console.log(`[LS] Activada (${eventName}) userId=${userId} hasta ${expiresAt}`);
        break;
      }

      // Renovación mensual exitosa — actualiza la fecha de expiración
      case 'subscription_payment_success': {
        const expiresAt = attrs.renews_at || null;
        await _activateSubscription(userId, { transactionId: txId, expiresAt });
        console.log(`[LS] Renovada userId=${userId} hasta ${expiresAt}`);
        break;
      }

      // Pago fallido recuperado — reactivar
      case 'subscription_payment_recovered': {
        const expiresAt = attrs.renews_at || null;
        await _activateSubscription(userId, { transactionId: txId, expiresAt });
        console.log(`[LS] Pago recuperado userId=${userId}`);
        break;
      }

      // ── Advertencia — sigue activa hasta el fin del período ────────────────
      case 'subscription_cancelled': {
        // No desactivamos aún — LS sigue activa hasta que venza
        // La desactivación real llega con subscription_expired
        console.log(`[LS] Cancelada (seguirá activa hasta ${attrs.ends_at}) userId=${userId}`);
        break;
      }

      case 'subscription_paused': {
        console.log(`[LS] Pausada userId=${userId}`);
        break;
      }

      case 'subscription_payment_failed': {
        // LS reintentará el cobro — no desactivamos aún
        console.log(`[LS] Pago fallido userId=${userId} — LS reintentará`);
        break;
      }

      // ── Desactivar ─────────────────────────────────────────────────────────
      case 'subscription_expired': {
        await _deactivateSubscription(userId);
        console.log(`[LS] Expirada → desactivada userId=${userId}`);
        break;
      }

      case 'order_refunded': {
        await _deactivateSubscription(userId);
        console.log(`[LS] Reembolso → desactivada userId=${userId}`);
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
 * Lemon Squeezy redirects here after checkout.
 * The Flutter WebView intercepts this URL before rendering.
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
  createCheckoutSession,
  lsWebhook,
  lsReturn,
  activateSubscription,
  checkSubscription,
};
