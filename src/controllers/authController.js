// src/controllers/authController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const logger = require('../utils/logger');

// Generar access token (corto plazo)
const generateAccessToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id, 
      email: user.email, 
      role: user.role 
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' } // 15 minutos
  );
};

// Generar refresh token (UPSERT - solo un registro por usuario)
const generateRefreshToken = async (userId, ip) => {
  const token = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 días
  
  // UPSERT: actualiza si existe, inserta si no
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, created_by_ip)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       token = EXCLUDED.token,
       expires_at = EXCLUDED.expires_at,
       revoked = false,
       created_at = NOW(),
       created_by_ip = EXCLUDED.created_by_ip`,
    [userId, token, expiresAt, ip]
  );
  
  return token;
};

// Genera un código único DEL-XXXX para el rol delivery
const generateDeliveryCode = async () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code, exists;
  do {
    const suffix = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    code = `DEL-${suffix}`;
    const result = await db.query(
      'SELECT id FROM users WHERE delivery_code = $1',
      [code]
    );
    exists = result.rows.length > 0;
  } while (exists);
  return code;
};

const register = async (req, res) => {
  const { email, password, name, phone, role, businessName } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  const allowedRoles = ['customer', 'provider', 'delivery', 'admin'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Rol inválido.' });
  }

  try {
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Generar código personal para deliveries
    const deliveryCode = role === 'delivery' ? await generateDeliveryCode() : null;

    const result = await db.query(
      `INSERT INTO users (email, password_hash, name, phone, role, business_name, is_active, delivery_code)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING id, email, name, role, business_name, delivery_code`,
      [email, passwordHash, name, phone, role, businessName || null, deliveryCode]
    );

    const user = result.rows[0];

    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user.id, clientIp);

    logger.info('Usuario registrado', { userId: user.id, email, role, ip: clientIp });

    res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessName: user.business_name,
        deliveryCode: user.delivery_code,
      }
    });
  } catch (error) {
    logger.error('Register error:', { email, error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;
  
  try {
    const result = await db.query(
      `SELECT id, email, name, password_hash, role, business_name, subscription_active, delivery_code
       FROM users WHERE email = $1 AND is_active = true`,
      [email]
    );
    
    if (result.rows.length === 0) {
      logger.warn('Intento de login fallido', { email, ip: clientIp, reason: 'user_not_found' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      logger.warn('Intento de login fallido', { email, ip: clientIp, reason: 'wrong_password' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user.id, clientIp);
    
    logger.info('Usuario logueado', { userId: user.id, email, ip: clientIp });
    
    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessName: user.business_name,
        subscriptionActive: user.subscription_active,
        deliveryCode: user.delivery_code,
      }
    });
  } catch (error) {
    logger.error('Login error:', { email, error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token requerido' });
  }
  
  try {
    const result = await db.query(
      `SELECT user_id, expires_at, revoked 
       FROM refresh_tokens 
       WHERE token = $1`,
      [refreshToken]
    );
    
    if (result.rows.length === 0) {
      logger.warn('Refresh token inválido', { ip: clientIp });
      return res.status(401).json({ error: 'Refresh token inválido' });
    }
    
    const tokenData = result.rows[0];
    
    if (tokenData.revoked) {
      logger.warn('Refresh token revocado', { userId: tokenData.user_id, ip: clientIp });
      return res.status(401).json({ error: 'Refresh token revocado' });
    }
    
    if (new Date() > tokenData.expires_at) {
      logger.warn('Refresh token expirado', { userId: tokenData.user_id, ip: clientIp });
      return res.status(401).json({ error: 'Refresh token expirado' });
    }
    
    const userResult = await db.query(
      `SELECT id, email, name, role, business_name
       FROM users WHERE id = $1 AND is_active = true`,
      [tokenData.user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    const user = userResult.rows[0];
    
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await generateRefreshToken(user.id, clientIp);
    
    // Revocar token viejo
    await db.query(
      'UPDATE refresh_tokens SET revoked = true WHERE token = $1',
      [refreshToken]
    );
    
    logger.info('Token refrescado', { userId: user.id, ip: clientIp });
    
    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
    
  } catch (error) {
    logger.error('Error en refreshToken', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const logout = async (req, res) => {
  const { refreshToken } = req.body;
  const userId = req.user?.userId;
  
  try {
    if (refreshToken) {
      await db.query(
        'UPDATE refresh_tokens SET revoked = true WHERE token = $1',
        [refreshToken]
      );
    }
    
    logger.info('Usuario cerró sesión', { userId });
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch (error) {
    logger.error('Error en logout', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const revokeAllUserTokens = async (req, res) => {
  const userId = req.user.userId;
  
  try {
    await db.query(
      'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
      [userId]
    );
    
    logger.info('Todos los tokens revocados', { userId });
    res.json({ success: true, message: 'Todas las sesiones cerradas' });
  } catch (error) {
    logger.error('Error revocando tokens', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

module.exports = { 
  register, 
  login, 
  refreshToken, 
  logout,
  revokeAllUserTokens
};