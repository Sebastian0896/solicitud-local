const admin = require('firebase-admin');

// Inicializar Firebase con el archivo JSON
let initialized = false;

function initializeFirebase() {
  if (initialized) return;
  
  try {
    // En Render, el archivo está en la raíz
    const serviceAccount = require('./service-account-key.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    console.log('✅ Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
  }
}

class FirebaseService {
  static async sendNotification(fcmToken, title, body, data = {}) {
    if (!fcmToken) return null;
    
    initializeFirebase();
    
    if (!initialized) {
      console.log(`⚠️ [MOCK] Notificación no enviada - Firebase no inicializado`);
      console.log(`   To: ${fcmToken.substring(0, 20)}...`);
      console.log(`   Title: ${title}`);
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
    
    if (!initialized) {
      console.log(`⚠️ [MOCK] Multicast not sent - Firebase not initialized`);
      return null;
    }
    
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
      console.error(`❌ Error sending multicast: ${error.message}`);
      return null;
    }
  }
}

module.exports = FirebaseService;