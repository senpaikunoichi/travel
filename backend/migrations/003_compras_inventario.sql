CREATE TABLE IF NOT EXISTS repuestos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  codigo VARCHAR(50) NULL,
  unidad VARCHAR(20) NOT NULL DEFAULT 'unidad',
  stock DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock_minimo DECIMAL(10,2) NOT NULL DEFAULT 0,
  precio_ref DECIMAL(12,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_repuestos_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tarea_repuestos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  id_repuesto INT NULL,
  descripcion VARCHAR(200) NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  estado ENUM('pendiente','retirado','faltante') NOT NULL DEFAULT 'pendiente',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tarea_repuestos_tarea (id_tarea),
  CONSTRAINT fk_tarea_repuestos_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id),
  CONSTRAINT fk_tarea_repuestos_repuesto FOREIGN KEY (id_repuesto) REFERENCES repuestos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presupuestos (
  mes CHAR(7) PRIMARY KEY,
  monto DECIMAL(12,2) NOT NULL,
  updated_by INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_presupuestos_usuario FOREIGN KEY (updated_by) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cotizaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  id_tarea_repuesto INT NULL,
  proveedor VARCHAR(120) NOT NULL,
  detalle VARCHAR(2000) NOT NULL,
  cantidad DECIMAL(10,2) NULL,
  monto DECIMAL(12,2) NOT NULL,
  ruta_archivo VARCHAR(500) NULL,
  estado ENUM('pendiente','aprobada','rechazada','recibida') NOT NULL DEFAULT 'pendiente',
  mes CHAR(7) NOT NULL,
  excedente DECIMAL(12,2) NOT NULL DEFAULT 0,
  nota_decision VARCHAR(1000) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by INT NULL,
  decided_at DATETIME NULL,
  received_at DATETIME NULL,
  INDEX idx_cotizaciones_mes (mes, estado),
  INDEX idx_cotizaciones_tarea (id_tarea),
  CONSTRAINT fk_cotizaciones_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id),
  CONSTRAINT fk_cotizaciones_linea FOREIGN KEY (id_tarea_repuesto) REFERENCES tarea_repuestos(id) ON DELETE SET NULL,
  CONSTRAINT fk_cotizaciones_creador FOREIGN KEY (created_by) REFERENCES usuarios(id),
  CONSTRAINT fk_cotizaciones_decisor FOREIGN KEY (decided_by) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notificaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  mensaje VARCHAR(300) NOT NULL,
  id_tarea INT NULL,
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notificaciones_usuario (id_usuario, leida, id),
  CONSTRAINT fk_notificaciones_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_notificaciones_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planes_mantencion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  cada_km INT NOT NULL,
  descripcion TEXT NULL,
  repuestos_json JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS camion_planes (
  patente VARCHAR(10) NOT NULL,
  id_plan INT NOT NULL,
  km_ultimo INT NOT NULL,
  avisado BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (patente, id_plan),
  CONSTRAINT fk_camion_planes_plan FOREIGN KEY (id_plan) REFERENCES planes_mantencion(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
