const nodemailer = require('nodemailer');
const logger = require('./logger');

const smtpPort = parseInt(process.env.SMTP_PORT || '587');
const _transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendVerificationEmail = async (email, name, code) => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  logger.info('sendVerificationEmail llamado', {
    to: email,
    smtpUser: smtpUser ? `${smtpUser.slice(0, 4)}***` : 'NO CONFIGURADO',
    smtpPassSet: !!smtpPass,
    code, // eliminar este log cuando el email funcione
  });

  if (!smtpUser || !smtpPass) {
    logger.warn('SMTP no configurado — el código está en este log:', { email, code });
    return;
  }
  const fromEmail = process.env.SMTP_FROM || smtpUser;
  await _transporter.sendMail({
    from: `"QuikoYA" <${fromEmail}>`,
    to: email,
    subject: 'Verifica tu cuenta en QuikoYA',
    html: `
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
  });
};

module.exports = { sendVerificationEmail };
