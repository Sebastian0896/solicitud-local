const admin = require('firebase-admin');

let initialized = false;

function initializeFirebase() {
  if (initialized) return;
  
  try {
    let serviceAccount;
    
    // En Render, usar variable de entorno
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase initialized from environment variable');
    }
    // En local, usar archivo
    else {
      try {
        serviceAccount = require('../service-account-key.json');
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log('✅ Firebase initialized from local file');
      } catch (e) {
        throw new Error('No se encontró archivo local');
      }
    }
    
    initialized = true;
  } catch (error) {
    console.warn('⚠️ Firebase not configured:', error.message);
  }
}

class FirebaseService {
  static async sendNotification(fcmToken, title, body, data = {}) {
    if (!fcmToken) return null;
    
    initializeFirebase();
    
    if (!initialized) {
      console.log(`⚠️ [MOCK] Notificación no enviada - Firebase no inicializado`);
      return null;
    }
    
    const message = {
      notification: { title, body },
      data: data,
      token: fcmToken,
    };
    
    try {
      const response = await admin.messaging().send(message);
      console.log(`✅ Notification sent to ${fcmToken.substring(0, 20)}...`);
      return response;
    } catch (error) {
      console.error(`❌ Error sending notification: ${error.message}`);
      return null;
    }
  }
  
  static async sendMulticastNotification(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return null;
    
    initializeFirebase();
    
    if (!initialized) return null;
    
    const validTokens = tokens.filter(t => t);
    if (validTokens.length === 0) return null;
    
    const message = {
      notification: { title, body },
      data: data,
      tokens: validTokens,
    };
    
    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`✅ Notifications sent: ${response.successCount}/${response.successCount + response.failureCount}`);
      return response;
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      return null;
    }
  }
}

module.exports = FirebaseService;