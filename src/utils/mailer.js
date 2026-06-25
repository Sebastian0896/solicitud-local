const logger = require('./logger');

const sendVerificationEmail = async (email, name, code) => {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.SMTP_FROM || 'noreply@quikoya.com';

  logger.info('sendVerificationEmail llamado', {
    to: email,
    apiKeySet: !!apiKey,
  });

  if (!apiKey) {
    logger.warn('BREVO_API_KEY no configurada', { email });
    return;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'QuikoYA', email: fromEmail },
      to: [{ email }],
      subject: 'Verifica tu cuenta en QuikoYA',
      trackClicks: false,
      trackOpens: false,
      htmlContent: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;">
          <h2 style="color:#10B981;">Hola ${name},</h2>
          <p>Gracias por registrarte en <strong>QuikoYA</strong>. Ingresa este código en la app para verificar tu cuenta:</p>
          <div style="background:#f0fdf4;border:2px solid #10B981;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
            <span style="font-size:48px;font-weight:800;letter-spacing:12px;color:#065f46;">${code}</span>
          </div>
          <p style="color:#6b7280;font-size:14px;">El código expira en <strong>30 minutos</strong>.</p>
          <p style="color:#6b7280;font-size:12px;">Si no creaste esta cuenta, ignora este mensaje.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API error ${response.status}: ${body}`);
  }
};

const sendPasswordResetEmail = async (email, name, resetUrl) => {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.SMTP_FROM || 'noreply@quikoya.com';

  if (!apiKey) {
    logger.warn('BREVO_API_KEY no configurada — no se envió email de reset', { email });
    return;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'QuikoYA', email: fromEmail },
      to: [{ email }],
      subject: 'Recupera tu contraseña — QuikoYA',
      trackClicks: false,
      trackOpens: false,
      htmlContent: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;">
          <h2 style="color:#10B981;">Hola ${name},</h2>
          <p>Recibimos una solicitud para restablecer tu contraseña de <strong>QuikoYA</strong>.</p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${resetUrl}"
               style="background:#10B981;color:#fff;padding:14px 32px;border-radius:8px;
                      text-decoration:none;font-weight:700;font-size:16px;">
              Restablecer contraseña
            </a>
          </div>
          <p style="color:#6b7280;font-size:14px;">Este enlace expira en <strong>1 hora</strong>.</p>
          <p style="color:#6b7280;font-size:12px;">Si no solicitaste esto, ignora este mensaje. Tu contraseña no cambiará.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API error ${response.status}: ${body}`);
  }
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
