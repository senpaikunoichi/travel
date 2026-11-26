CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL,
  rol ENUM('admin','jefe','encargado','mecanico') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS camiones (
  patente VARCHAR(10) PRIMARY KEY,
  numero VARCHAR(10) NOT NULL,
  modelo VARCHAR(50) NOT NULL,
  estado_operativo ENUM('activo','panne') NOT NULL DEFAULT 'activo'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tareas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo_tarea VARCHAR(100) NOT NULL,
  patente_camion VARCHAR(10) NOT NULL,
  descripcion TEXT NULL,
  fecha_creacion DATE NOT NULL,
  fecha_limite DATE NOT NULL,
  estado ENUM('Pendiente','En_Trabajo','Completada','Aprobada') NOT NULL DEFAULT 'Pendiente',
  fecha_completada DATE NULL,
  created_by INT NOT NULL,
  vencida BOOLEAN NOT NULL DEFAULT FALSE,
  veces_aplazada INT NOT NULL DEFAULT 0,
  motivo_aplazamiento TEXT NULL,
  nota_rechazo VARCHAR(2000) NULL,
  fecha_rechazo DATETIME NULL,
  veces_rechazada INT NOT NULL DEFAULT 0,
  INDEX idx_tareas_camion (patente_camion),
  INDEX idx_tareas_creador (created_by),
  INDEX idx_tareas_estado_fecha (estado, fecha_limite),
  CONSTRAINT fk_tareas_camion FOREIGN KEY (patente_camion) REFERENCES camiones(patente),
  CONSTRAINT fk_tareas_creador FOREIGN KEY (created_by) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tarea_mecanicos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  id_mecanico INT NOT NULL,
  UNIQUE KEY uq_tarea_mecanico (id_tarea, id_mecanico),
  INDEX idx_tarea_mecanicos_mecanico (id_mecanico),
  CONSTRAINT fk_tarea_mecanicos_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id),
  CONSTRAINT fk_tarea_mecanicos_usuario FOREIGN KEY (id_mecanico) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gastos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(10,2) NULL,
  fecha DATE NOT NULL,
  tipo ENUM('mecanico','factura') NULL,
  INDEX idx_gastos_tarea (id_tarea),
  INDEX idx_gastos_fecha (fecha),
  CONSTRAINT fk_gastos_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evidencia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  tipo ENUM('foto','boleta','factura') NOT NULL,
  fecha DATE NOT NULL,
  INDEX idx_evidencia_tarea (id_tarea),
  CONSTRAINT fk_evidencia_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
