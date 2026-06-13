const admin = require('firebase-admin');
const db = require('../config/database');

let initialized = false;

function initializeFirebase() {
  if (initialized) return;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase initialized from environment variable');
    } else {
      const serviceAccount = require('../service-account-key.json');
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase initialized from local file');
    }
    initialized = true;
  } catch (error) {
    console.warn('⚠️ Firebase not configured:', error.message);
  }
}

// Si el token es inválido/expirado, lo borramos de la BD para no seguir intentando
async function _clearInvalidToken(fcmToken) {
  try {
    await db.query(`UPDATE users SET fcm_token = NULL WHERE fcm_token = $1`, [fcmToken]);
    console.log(`🧹 Token FCM inválido eliminado de la BD`);
  } catch (_) {}
}

function _isInvalidTokenError(error) {
  const code = error.code || '';
  const msg = error.message || '';
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    msg.includes('not found') ||
    msg.includes('Requested entity was not found')
  );
}

class FirebaseService {
  static async sendNotification(fcmToken, title, body, data = {}) {
    if (!fcmToken) return null;
    initializeFirebase();
    if (!initialized) return null;

    // Todos los valores de data deben ser strings para FCM
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
    );

    try {
      const response = await admin.messaging().send({
        notification: { title, body },
        data: stringData,
        token: fcmToken,
        android: { priority: 'high' },
      });
      console.log(`✅ Notification sent to ${fcmToken.substring(0, 20)}...`);
      return response;
    } catch (error) {
      console.error(`❌ Error sending notification: ${error.message}`);
      if (_isInvalidTokenError(error)) {
        await _clearInvalidToken(fcmToken);
      }
      return null;
    }
  }

  static async sendMulticastNotification(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return null;
    initializeFirebase();
    if (!initialized) return null;

    const validTokens = tokens.filter(Boolean);
    if (validTokens.length === 0) return null;

    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
    );

    try {
      const response = await admin.messaging().sendEachForMulticast({
        notification: { title, body },
        data: stringData,
        tokens: validTokens,
        android: { priority: 'high' },
      });
      console.log(`✅ Notifications sent: ${response.successCount}/${validTokens.length}`);

      // Limpiar tokens inválidos
      response.responses.forEach((r, i) => {
        if (!r.success && _isInvalidTokenError(r.error)) {
          _clearInvalidToken(validTokens[i]);
        }
      });

      return response;
    } catch (error) {
      console.error(`❌ Error multicast: ${error.message}`);
      return null;
    }
  }
}

module.exports = FirebaseService;
