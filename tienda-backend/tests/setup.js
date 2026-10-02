const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

// ============================================================================
// GUARDA ESTRICTA ANTI-ATLAS
// Si cualquier parte del entorno o código intenta conectar a MongoDB Atlas,
// aborta inmediatamente la ejecución del test runner.
// ============================================================================
const originalConnect = mongoose.connect.bind(mongoose);
mongoose.connect = async function(uri, options) {
  if (typeof uri === 'string' && (uri.includes('mongodb.net') || uri.includes('atlas') || uri.includes('cluster'))) {
    throw new Error(`🚨 SEGURIDAD CRÍTICA: Intento de conexión a MongoDB Atlas detectado y bloqueado en entorno de prueba. URI: ${uri}`);
  }
  return originalConnect(uri, options);
};

let mongoServer;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_jwt_secret_super_safe_12345';
  process.env.MP_ACCESS_TOKEN = 'test_mp_access_token_dummy';
  process.env.MP_WEBHOOK_SECRET = 'test_webhook_secret_mp_789xyz';

  // Iniciar servidor en memoria primero
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  // Sobrescribir MONGO_URI antes de que cualquier import cargue .env
  process.env.MONGO_URI = uri;

  // Verificación estricta de que la URI sea 100% local en memoria
  if (process.env.MONGO_URI.includes('mongodb.net') || process.env.MONGO_URI.includes('atlas')) {
    throw new Error('🚨 SEGURIDAD CRÍTICA: MONGO_URI apunta a Atlas. Abortando.');
  }

  await mongoose.connect(uri);

  // Mock de Nodemailer para evitar llamadas salientes reales y timeouts
  const { transporter } = require('../src/config/email');
  if (transporter) {
    transporter.sendMail = jest.fn().mockResolvedValue({ messageId: 'test-email-ok' });
  }
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});
