/**
 * CardNet (Azul) Payment Service — Solicitud Local
 *
 * Credenciales requeridas (variables de entorno):
 *   CARDNET_AUTH1          → Token de autenticación 1 (proporcionado por CardNet)
 *   CARDNET_AUTH2          → Token de autenticación 2 (proporcionado por CardNet)
 *   CARDNET_MERCHANT_ID    → ID de comercio (proporcionado por CardNet)
 *   CARDNET_CHANNEL        → Canal (por defecto 'EC' para E-Commerce)
 *   CARDNET_API_URL        → URL del API de Azul (ver abajo)
 *   CARDNET_WEBHOOK_SECRET → Secreto HMAC para verificar webhooks (opcional pero recomendado)
 *   BACKEND_URL            → URL pública del backend (para las URLs de retorno)
 *
 * URLs del API de Azul/CardNet DR:
 *   Pruebas:    https://pruebas.azul.com.do/webservices/JSON/default.aspx
 *   Producción: https://pagos.azul.com.do/webservices/JSON/default.aspx
 */

const https = require('https');
const crypto = require('crypto');

const CARDNET_API_URL =
  process.env.CARDNET_API_URL ||
  'https://pruebas.azul.com.do/webservices/JSON/default.aspx';

const BACKEND_URL =
  process.env.BACKEND_URL || 'https://solicitud-local.onrender.com';

// Precio de suscripción en centavos (RD$299.00 → "29900")
const SUBSCRIPTION_AMOUNT_CENTS = '29900';
const SUBSCRIPTION_ITBIS_CENTS  = '0';
const SUBSCRIPTION_CURRENCY     = '$'; // Azul usa '$' para DOP

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea una sesión de pago en CardNet/Azul y devuelve la URL de la
 * página de pago alojada por Azul.
 *
 * @param {{ userId: string|number, orderId: string }} params
 * @returns {{ paymentUrl: string, azulOrderId: string }}
 */
const createCardNetSession = async ({ userId, orderId }) => {
  const { CARDNET_AUTH1, CARDNET_AUTH2, CARDNET_MERCHANT_ID, CARDNET_CHANNEL } =
    process.env;

  if (!CARDNET_AUTH1 || !CARDNET_AUTH2 || !CARDNET_MERCHANT_ID) {
    throw new Error(
      'CardNet no configurado. Agrega CARDNET_AUTH1, CARDNET_AUTH2 y CARDNET_MERCHANT_ID en las variables de entorno.'
    );
  }

  const approvedUrl = `${BACKEND_URL}/api/subscriptions/cardnet/return?status=approved&orderId=${orderId}&userId=${userId}`;
  const declinedUrl = `${BACKEND_URL}/api/subscriptions/cardnet/return?status=declined&orderId=${orderId}&userId=${userId}`;
  const cancelUrl   = `${BACKEND_URL}/api/subscriptions/cardnet/return?status=cancelled&orderId=${orderId}&userId=${userId}`;

  const payload = {
    // Identificación del comercio
    Store:       CARDNET_MERCHANT_ID,
    Channel:     CARDNET_CHANNEL || 'EC',

    // Datos del pedido
    OrderNumber: orderId,
    Amount:      SUBSCRIPTION_AMOUNT_CENTS,
    ITBIS:       SUBSCRIPTION_ITBIS_CENTS,
    Currency:    SUBSCRIPTION_CURRENCY,

    // Descripción que ve el cliente en la página de Azul
    CustomField1Label: 'Descripción',
    CustomField1:      'Suscripción mensual Solicitud Local Pro',
    CustomField2Label: 'UserId',
    CustomField2:      userId.toString(),

    // URLs de retorno
    ApprovedUrl: approvedUrl,
    DeclinedUrl: declinedUrl,
    CancelUrl:   cancelUrl,
  };

  const responseData = await _postToCardNet(payload, {
    Auth1: CARDNET_AUTH1,
    Auth2: CARDNET_AUTH2,
  });

  // Azul devuelve ResponseCode '00' para éxito en la creación de la sesión
  if (responseData.ResponseCode !== '00') {
    throw new Error(
      `CardNet rechazó la sesión: [${responseData.ResponseCode}] ${responseData.ResponseMessage}`
    );
  }

  return {
    paymentUrl:  responseData.RedirectUrl || responseData.PaymentPageUrl,
    azulOrderId: responseData.AzulOrderId || orderId,
  };
};

/**
 * Verifica la firma HMAC que CardNet envía en el header del webhook.
 * Si CARDNET_WEBHOOK_SECRET no está configurado, omite la verificación.
 *
 * @param {object} body    Body del webhook (objeto JSON)
 * @param {string} sigHeader Header 'X-Azul-Signature' (u equivalente de CardNet)
 * @returns {boolean}
 */
const verifyWebhookSignature = (body, sigHeader) => {
  const secret = process.env.CARDNET_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[CardNet] CARDNET_WEBHOOK_SECRET no configurado — omitiendo verificación de firma');
    return true;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');

  return expected === sigHeader;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hace un POST al API de Azul/CardNet con autenticación por headers.
 * Usa el módulo nativo `https` para evitar dependencias extras.
 */
const _postToCardNet = (payload, authHeaders) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url  = new URL(CARDNET_API_URL);

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        Auth1: authHeaders.Auth1,
        Auth2: authHeaders.Auth2,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`CardNet respondió con formato inválido: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('CardNet no respondió a tiempo (15s).'));
    });
    req.write(body);
    req.end();
  });
};

module.exports = { createCardNetSession, verifyWebhookSignature };
