// src/services/firebaseService.js
const admin = require('firebase-admin');

// Inicializar Firebase Admin SDK (necesitas descargar la clave de servicio)
// Para desarrollo, puedes crear un archivo service-account-key.json desde Firebase Console
let initialized = false;

function initializeFirebase() {
  if (initialized) return;
  
  try {
    // Intentar inicializar con variable de entorno
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      // Para desarrollo, usar archivo local
      const serviceAccount = require('../service-account-key.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    initialized = true;
    console.log('✅ Firebase Admin SDK initialized');
  } catch (error) {
    console.warn('⚠️ Firebase not configured. Notifications disabled.');
  }
}

class FirebaseService {
  // Enviar notificación a un usuario específico
  static async sendNotification(fcmToken, title, body, data = {}) {
    if (!fcmToken) return null;
    
    initializeFirebase();
    
    // Si no se pudo inicializar Firebase, solo loguear
    if (!initialized) {
      console.log(`[MOCK NOTIFICATION] To: ${fcmToken.substring(0, 20)}... Title: ${title}`);
      return null;
    }
    
    const message = {
      notification: { title, body },
      data: data,
      token: fcmToken,
    };
    
    try {
      const response = await admin.messaging().send(message);
      console.log('✅ Notification sent:', response);
      return response;
    } catch (error) {
      console.error('❌ Error sending notification:', error.message);
      return null;
    }
  }
  
  // Enviar a múltiples usuarios
  static async sendMulticastNotification(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return null;
    
    initializeFirebase();
    
    if (!initialized) {
      console.log(`[MOCK NOTIFICATION] Multicast to ${tokens.length} users. Title: ${title}`);
      return null;
    }
    
    const message = {
      notification: { title, body },
      data: data,
      tokens: tokens.filter(t => t), // Remover tokens nulos
    };
    
    if (message.tokens.length === 0) return null;
    
    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`✅ Notifications sent: ${response.successCount}/${response.successCount + response.failureCount}`);
      return response;
    } catch (error) {
      console.error('❌ Error sending multicast notification:', error.message);
      return null;
    }
  }
}

module.exports = FirebaseService;