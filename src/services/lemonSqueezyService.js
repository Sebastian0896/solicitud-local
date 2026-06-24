/**
 * Lemon Squeezy Payment Service
 *
 * Env vars required:
 *   LEMONSQUEEZY_API_KEY       – API key from LS dashboard
 *   LEMONSQUEEZY_WEBHOOK_SECRET – signing secret for webhook verification
 *   LEMONSQUEEZY_STORE_ID      – numeric store ID
 *   LEMONSQUEEZY_VARIANT_ID    – variant ID for the monthly subscription product
 *   BACKEND_URL                – public backend URL (for redirect_url)
 */

const https = require('https');
const crypto = require('crypto');

const LS_API_BASE = 'api.lemonsqueezy.com';
const BACKEND_URL = process.env.BACKEND_URL || 'https://solicitud-local.onrender.com';

/**
 * Creates a hosted checkout session in Lemon Squeezy.
 * Returns the URL the user should be redirected to.
 *
 * @param {{ userId: string, userEmail: string }} params
 * @returns {Promise<string>} checkoutUrl
 */
const createCheckout = async ({ userId, userEmail }) => {
  const { LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, LEMONSQUEEZY_VARIANT_ID } = process.env;

  if (!LEMONSQUEEZY_API_KEY || !LEMONSQUEEZY_STORE_ID || !LEMONSQUEEZY_VARIANT_ID) {
    throw new Error(
      'Lemon Squeezy no configurado. Agrega LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID y LEMONSQUEEZY_VARIANT_ID.'
    );
  }

  const redirectUrl = `${BACKEND_URL}/api/subscriptions/ls/return?status=success`;

  const payload = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: userEmail || undefined,
          custom: { user_id: String(userId) },
        },
        product_options: {
          redirect_url: redirectUrl,
          receipt_button_text: 'Volver a la app',
          receipt_thank_you_note: '¡Gracias por suscribirte a QuikoYA Pro!',
        },
        checkout_options: {
          dark: false,
          logo: true,
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: String(LEMONSQUEEZY_STORE_ID) } },
        variant: { data: { type: 'variants', id: String(LEMONSQUEEZY_VARIANT_ID) } },
      },
    },
  };

  const data = await _lsPost('/v1/checkouts', payload);
  const url = data?.data?.attributes?.url;

  if (!url) {
    throw new Error('Lemon Squeezy no devolvió la URL de checkout.');
  }

  return url;
};

/**
 * Verifies the X-Signature header from a Lemon Squeezy webhook.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param {Buffer} rawBody  - raw request body (req.rawBody)
 * @param {string} sigHeader - value of X-Signature header
 * @returns {boolean}
 */
const verifyWebhookSignature = (rawBody, sigHeader) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[LemonSqueezy] LEMONSQUEEZY_WEBHOOK_SECRET no configurado — omitiendo verificación');
    return true;
  }

  if (!sigHeader) return false;

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(sigHeader, 'hex'));
  } catch {
    return false;
  }
};

/**
 * Cancels a Lemon Squeezy subscription at period end.
 * @param {string} lsSubscriptionId
 */
const cancelSubscription = (lsSubscriptionId) =>
  _lsRequest('DELETE', `/v1/subscriptions/${lsSubscriptionId}`);

/**
 * Resumes a cancelled subscription (before it expires).
 * @param {string} lsSubscriptionId
 */
const resumeSubscription = (lsSubscriptionId) =>
  _lsRequest('PATCH', `/v1/subscriptions/${lsSubscriptionId}`, {
    data: {
      type: 'subscriptions',
      id: String(lsSubscriptionId),
      attributes: { cancelled: false },
    },
  });

// ─── helpers ─────────────────────────────────────────────────────────────────

const _lsPost = (path, payload) =>
  _lsRequest('POST', path, payload);

const _lsRequest = (method, path, payload) =>
  new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : undefined;
    const options = {
      hostname: LS_API_BASE,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Lemon Squeezy error ${res.statusCode}: ${data}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Respuesta inválida de Lemon Squeezy: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Lemon Squeezy no respondió a tiempo (15s).'));
    });

    if (body) req.write(body);
    req.end();
  });

module.exports = { createCheckout, verifyWebhookSignature, cancelSubscription, resumeSubscription };
