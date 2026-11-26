CREATE TABLE IF NOT EXISTS camion_km_diario (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patente VARCHAR(10) NOT NULL,
  fecha DATE NOT NULL,
  km DECIMAL(10,1) NOT NULL,
  rutas INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_camion_km_diario_patente_fecha (patente, fecha),
  INDEX idx_camion_km_diario_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
