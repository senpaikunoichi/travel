CREATE TABLE IF NOT EXISTS inspecciones_camion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patente_camion VARCHAR(10) NOT NULL,
  fecha DATE NOT NULL,
  ruta VARCHAR(150) NULL,
  id_encargado INT NOT NULL,
  id_inspeccion_anterior INT NULL,
  estado_analisis ENUM('linea_base','analizado','error') NOT NULL DEFAULT 'linea_base',
  nivel_dano ENUM('sin_cambios','leve','moderado','grave','inconcluso') NOT NULL DEFAULT 'sin_cambios',
  hay_diferencias BOOLEAN NOT NULL DEFAULT FALSE,
  resumen VARCHAR(2000) NOT NULL,
  hallazgos_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inspeccion_camion_fecha (patente_camion, fecha, id),
  CONSTRAINT fk_inspeccion_camion FOREIGN KEY (patente_camion) REFERENCES camiones(patente),
  CONSTRAINT fk_inspeccion_encargado FOREIGN KEY (id_encargado) REFERENCES usuarios(id),
  CONSTRAINT fk_inspeccion_anterior FOREIGN KEY (id_inspeccion_anterior) REFERENCES inspecciones_camion(id)
);

CREATE TABLE IF NOT EXISTS inspeccion_fotos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_inspeccion INT NOT NULL,
  lado ENUM('frente','posterior','izquierdo','derecho') NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  UNIQUE KEY uq_inspeccion_lado (id_inspeccion, lado),
  CONSTRAINT fk_inspeccion_foto FOREIGN KEY (id_inspeccion) REFERENCES inspecciones_camion(id) ON DELETE CASCADE
);
