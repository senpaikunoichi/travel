CREATE TABLE IF NOT EXISTS planes_mantenimiento (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  cada_km INT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_planes_activo (activo, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS camion_planes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patente VARCHAR(10) NOT NULL,
  id_plan INT NOT NULL,
  km_ultimo INT NULL,
  avisado_pronto BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_camion_plan (patente, id_plan),
  INDEX idx_camion_planes_plan (id_plan),
  CONSTRAINT fk_camion_planes_plan FOREIGN KEY (id_plan) REFERENCES planes_mantenimiento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tarea_repuestos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  repuesto_id INT NULL,
  descripcion VARCHAR(500) NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  estado ENUM('faltante','cotizando','aprobado','recibido','retirado','resuelto') NOT NULL DEFAULT 'faltante',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tarea_repuestos_tarea (id_tarea),
  INDEX idx_tarea_repuestos_repuesto (repuesto_id),
  CONSTRAINT fk_tarea_repuestos_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tarea_repuestos_repuesto FOREIGN KEY (repuesto_id) REFERENCES repuestos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cotizaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  id_tarea_repuesto INT NULL,
  proveedor VARCHAR(200) NOT NULL,
  detalle VARCHAR(1000) NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  monto DECIMAL(12,2) NOT NULL,
  estado ENUM('pendiente','aprobada','rechazada','recibida') NOT NULL DEFAULT 'pendiente',
  nota_rechazo VARCHAR(1000) NULL,
  ruta_comprobante VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cotizaciones_estado_fecha (estado, created_at),
  INDEX idx_cotizaciones_tarea (id_tarea),
  INDEX idx_cotizaciones_repuesto_tarea (id_tarea_repuesto),
  CONSTRAINT fk_cotizaciones_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotizaciones_tarea_repuesto FOREIGN KEY (id_tarea_repuesto) REFERENCES tarea_repuestos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presupuestos_mensuales (
  mes DATE PRIMARY KEY,
  monto DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
