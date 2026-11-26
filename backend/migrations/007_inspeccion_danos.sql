CREATE TABLE IF NOT EXISTS inspeccion_danos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_inspeccion INT NOT NULL,
  lado ENUM('frente','posterior','izquierdo','derecho') NOT NULL,
  x DECIMAL(6,3) NOT NULL,
  y DECIMAL(6,3) NOT NULL,
  descripcion VARCHAR(1000) NOT NULL,
  ruta_archivo VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inspeccion_danos_inspeccion (id_inspeccion),
  CONSTRAINT fk_inspeccion_danos_inspeccion FOREIGN KEY (id_inspeccion) REFERENCES inspecciones_camion(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
