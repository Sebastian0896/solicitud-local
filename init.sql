-- Habilitar PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabla users (versión completa)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  role VARCHAR(50) CHECK (role IN ('customer', 'provider', 'admin')),
  is_active BOOLEAN DEFAULT true,
  business_name VARCHAR(255),
  available BOOLEAN DEFAULT false,
  active_requests INTEGER DEFAULT 0,
  max_requests INTEGER DEFAULT 3,
  service_radius_km INTEGER DEFAULT 5,
  subscription_active BOOLEAN DEFAULT false,
  subscription_expires_at TIMESTAMP,
  current_location GEOGRAPHY(POINT, 4326),
  fcm_token TEXT, -- para notificaciones push
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla requests
CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id),
  provider_id UUID REFERENCES users(id),
  request_text TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'assigned', 'on_the_way', 'delivered', 'cancelled')),
  customer_name VARCHAR(255),
  customer_phone VARCHAR(50),
  provider_name VARCHAR(255),
  customer_location GEOGRAPHY(POINT, 4326),
  created_at TIMESTAMP DEFAULT NOW(),
  assigned_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Tabla notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla subscription_payments (para Mercado Pago)
CREATE TABLE subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  mercado_pago_preapproval_id VARCHAR(255),
  amount DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'DOP',
  status VARCHAR(50),
  starts_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ÍNDICES para rendimiento
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_customer_id ON requests(customer_id);
CREATE INDEX idx_requests_provider_id ON requests(provider_id);
CREATE INDEX idx_requests_created_at ON requests(created_at DESC);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_available ON users(available) WHERE role = 'provider';
CREATE INDEX idx_users_subscription ON users(subscription_active) WHERE role = 'provider';
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;

-- Índice espacial para búsqueda de proveedores cercanos
CREATE INDEX idx_users_location ON users USING GIST (current_location);
CREATE INDEX idx_requests_location ON requests USING GIST (customer_location);

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();