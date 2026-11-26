// Browser regression checks. API fixtures are restricted to this test process.
// PLAYWRIGHT_MODULE and CHROME_PATH can point to an existing local installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const output = path.join(__dirname, 'screenshots')
fs.mkdirSync(output, { recursive: true })
const base = process.env.TEST_URL || 'http://127.0.0.1:5173'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined })
  let checks = 0
  try {
    for (const role of ['admin', 'encargado', 'mecanico', 'jefe']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      let failLoad = false
      let failLogin = false
      let failWrite = false
      let tasks = ['Pendiente', 'En_Trabajo', 'Completada', 'Aprobada'].map((estado, i) => ({ id: i + 1, tipo_tarea: ['Cambio de embrague', 'Revisión de frenos', 'Cambio de aceite', 'Inspección general'][i], patente_camion: 'ABC-123', modelo: 'Volvo FH16', fecha_limite: '2026-09-15', descripcion: 'Revisar el sistema y registrar las evidencias del mantenimiento.', estado, vencida: i === 0, veces_aplazada: 1 }))
      let trucks = [{ patente: 'ABC-123', numero: '12', modelo: 'Volvo FH16' }]
      let users = [{ id: 1, nombre: 'Persona de prueba', email: 'prueba@example.test', rol: 'mecanico' }]
      const evidence = [], expenses = [], writes = []
      let checklist = null
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), endpoint = url.pathname, method = req.method()
        let data = { success: true }, status = 200
        if (failWrite && method !== 'GET') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ mensaje: 'No se pudo guardar el registro de prueba.' }) })
        if (method !== 'GET') writes.push({ endpoint, method, body: req.headers()['content-type']?.includes('json') ? req.postDataJSON() : null })
        if (endpoint === '/api/login') { data = failLogin ? { success: false } : { success: true, usuario: { id: 1, nombre: 'Usuario de prueba', rol: role } }; status = failLogin ? 401 : 200 }
        else if (/^\/api\/tareas\/\d+\/checklist$/.test(endpoint)) { if (method === 'PUT') checklist = { id: 1, ...req.postDataJSON(), responsable: 'Usuario de prueba', fallas: 0, created_at: '2026-11-16 12:00:00' }; data.checklist = checklist; data.mensaje = 'Checklist guardado: todo bien.' }
        else if (method === 'GET' && endpoint.startsWith('/api/tareas')) { data.tareas = tasks; if (failLoad) status = 500 }
        else if (endpoint === '/api/mecanicos') data.mecanicos = [{ id: 1, nombre: 'Persona de prueba' }]
        else if (endpoint === '/api/camiones') data.camiones = trucks
        else if (endpoint === '/api/usuarios') data.usuarios = users
        else if (endpoint === '/api/checklist/plantilla') data.plantilla = [{ titulo: '1. Exterior', items: [{ codigo: '1.1', nombre: 'Carrocería y pintura' }, { codigo: '1.2', nombre: 'Luces' }] }]
        else if (endpoint === '/api/inventario/revision' && method === 'GET') Object.assign(data, { hoy: '2026-11-16', semana: '2026-11-16', fin: '2026-11-22', actual: '2026-11-16', items: [{ id_repuesto: 2, nombre: 'Aceite motor', unidad: 'litro', stock: 20, revision: null }], faltantes: [], historial: [] })
        else if (endpoint === '/api/repuestos') data.repuestos = [{ id: 1, nombre: 'Filtro de aire', stock: 0, stock_minimo: 2, unidad: 'unidad' }, { id: 2, nombre: 'Aceite motor', stock: 20, stock_minimo: 5, unidad: 'litro' }]
        else if (endpoint === '/api/notificaciones') Object.assign(data, { notificaciones: [{ id: 1, mensaje: 'Solicitud de compra (sin OT): Taladro · $90.000.', id_tarea: null, leida: 0, created_at: '2026-11-13 10:00:00' }], sin_leer: 1 })
        else if (endpoint === '/api/kpis') Object.assign(data, { gastosMes: 1234500, gastosSemana: 123450, totalGastos: 9876500, tareasMecanico: [{ nombre: 'Persona de prueba', total_asignadas: 4, completadas: 2 }] })
        else if (endpoint.startsWith('/api/gastos/') && method === 'GET') data.gastos = expenses
        else if (endpoint.startsWith('/api/evidencia/') && method === 'GET') data.evidencias = evidence
        else if (endpoint.startsWith('/api/tareas/estado/')) tasks = tasks.map(t => t.id === Number(endpoint.split('/').pop()) ? { ...t, estado: req.postDataJSON().estado } : t)
        else if (endpoint === '/api/tareas/crear') tasks.push({ ...req.postDataJSON(), id: 8, estado: 'Pendiente' })
        else if (endpoint === '/api/camiones/agregar') trucks.push(req.postDataJSON())
        else if (endpoint.startsWith('/api/camiones/editar/')) trucks = trucks.map(t => t.patente === decodeURIComponent(endpoint.split('/').pop()) ? { ...t, ...req.postDataJSON() } : t)
        else if (endpoint === '/api/usuarios/agregar') users.push({ ...req.postDataJSON(), id: 2 })
        else if (endpoint.startsWith('/api/usuarios/editar/')) users = users.map(u => u.id === Number(endpoint.split('/').pop()) ? { ...u, ...req.postDataJSON() } : u)
        else if (endpoint === '/api/gastos/agregar') expenses.push({ id: expenses.length + 1, tipo: 'mecanico', fecha: '2026-09-15', ...req.postDataJSON() })
        else if (endpoint.includes('/api/evidencia/media/') || endpoint.includes('/api/evidencia/factura/')) evidence.push({ id: evidence.length + 1, tipo: endpoint.includes('/factura/') ? 'factura' : url.searchParams.get('momento') === 'antes' ? 'antes' : 'foto', ruta_archivo: '/assets/logo-travel-trans.png' })
        else if (method === 'DELETE') {
          const id = endpoint.split('/').pop()
          if (endpoint.includes('/tareas/')) tasks = tasks.filter(t => t.id !== Number(id))
          if (endpoint.includes('/camiones/')) trucks = trucks.filter(t => t.patente !== decodeURIComponent(id))
          if (endpoint.includes('/usuarios/')) users = users.filter(u => u.id !== Number(id))
        } else if (endpoint === '/api/exportar/excel') return route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: 'test-download' })
        await pause(30)
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      })
      await page.goto(base)
      await page.getByLabel('Email', { exact: true }).fill('prueba@example.test')
      await page.getByLabel('Contraseña', { exact: true }).fill('test-password')
      if (role === 'admin') {
        failLogin = true
        await page.getByRole('button', { name: 'Iniciar Sesión' }).click()
        await page.getByRole('alert').waitFor()
        assert.match(await page.getByRole('alert').innerText(), /incorrectos/); checks++
        failLogin = false; failLoad = true
      }
      await page.getByRole('button', { name: 'Iniciar Sesión' }).click()
      if (role === 'admin') {
        await page.getByRole('button', { name: 'Reintentar' }).waitFor()
        failLoad = false
        await page.getByRole('button', { name: 'Reintentar' }).click(); checks++
      }
      await page.locator('.summary-card').first().waitFor()
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 950 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${role}: overflow at ${width}`)
        assert.equal(await page.locator('input,select,textarea').evaluateAll(elements => elements.filter(el => !el.labels?.length && !el.getAttribute('aria-label')).length), 0)
        checks += 2
        if (width === 390 || width === 1440) await page.screenshot({ path: path.join(output, `${role}-${width}.png`), fullPage: true })
      }
      await page.getByRole('button', { name: 'Menú', exact: true }).click()
      await page.getByRole('navigation').getByRole('link', { name: /^(Tareas|Mis tareas)$/ }).click()
      assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded'), 'false'); checks++
      await page.getByLabel('Buscar tarea, patente o mecánico').fill('sin coincidencia')
      await page.getByText('No hay tareas que coincidan con los filtros.').waitFor(); checks++
      await page.getByLabel('Buscar tarea, patente o mecánico').fill('')
      await page.getByLabel('Estado', { exact: true }).selectOption('Completada')
      await page.getByText('1 de 4 tareas').waitFor(); checks++
      await page.getByLabel('Estado', { exact: true }).selectOption('')
      if (role === 'admin' || role === 'encargado') {
        await page.getByRole('button', { name: '+ Nueva tarea', exact: true }).click()
        await page.getByLabel('Trabajo a realizar').fill('Prueba de creación')
        await page.getByLabel('Camión', { exact: true }).selectOption('ABC-123')
        await page.getByLabel('Fecha límite').fill('2026-09-20')
        await page.getByRole('button', { name: 'Crear y enviar al mecánico' }).click()
        await page.getByText('Selecciona al menos un mecánico.').waitFor()
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Crear y enviar al mecánico' }).click()
        await page.getByText('Prueba de creación', { exact: true }).waitFor()
        assert.equal(writes.filter(w => w.endpoint === '/api/tareas/crear').length, 1); checks += 2
      }
      if (role === 'admin') {
        const section = page.locator('#camiones')
        await section.getByRole('button', { name: '+ Agregar', exact: true }).click()
        await page.getByLabel('Patente', { exact: true }).fill('XYZ-789')
        await page.getByLabel('Número', { exact: true }).fill('99')
        await page.getByLabel('Modelo', { exact: true }).fill('Camión de prueba')
        failWrite = true
        await page.getByRole('button', { name: 'Guardar', exact: true }).click()
        await page.getByText('No se pudo guardar el registro de prueba.').waitFor()
        assert.equal(await page.getByLabel('Modelo', { exact: true }).inputValue(), 'Camión de prueba'); checks++
        failWrite = false
        await page.getByRole('button', { name: 'Guardar', exact: true }).click()
        const row = section.getByRole('row').filter({ hasText: 'XYZ-789' })
        await row.waitFor()
        await row.getByRole('button', { name: 'Editar' }).click()
        await page.getByLabel('Modelo', { exact: true }).fill('Modelo actualizado')
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        await section.getByText('Modelo actualizado').waitFor()
        await row.getByRole('button', { name: 'Eliminar' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
        assert.equal(trucks.length, 2)
        await row.getByRole('button', { name: 'Eliminar' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click()
        await row.waitFor({ state: 'detached' }); checks += 4
        const userSection = page.locator('#usuarios')
        await userSection.getByRole('button', { name: '+ Agregar', exact: true }).click()
        await page.getByLabel('Nombre', { exact: true }).fill('Nuevo usuario')
        await page.getByLabel('Email', { exact: true }).fill('nuevo@example.test')
        await page.getByLabel('Contraseña', { exact: true }).fill('test-only-password')
        await page.getByRole('button', { name: 'Guardar', exact: true }).click()
        const userRow = userSection.getByRole('row').filter({ hasText: 'nuevo@example.test' })
        await userRow.waitFor()
        await userRow.getByRole('button', { name: 'Editar' }).click()
        await page.getByLabel('Nombre', { exact: true }).fill('Usuario actualizado')
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        await userSection.getByText('Usuario actualizado').waitFor()
        await userRow.getByRole('button', { name: 'Eliminar' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click()
        await userRow.waitFor({ state: 'detached' }); checks += 3
        const taskRow = page.locator('#tareas').getByRole('row').filter({ hasText: 'Prueba de creación' })
        await taskRow.getByRole('button', { name: 'Eliminar' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click()
        await taskRow.waitFor({ state: 'detached' }); checks++
      }
      if (role === 'mecanico') {
        // Pantalla simple: qué hay que hacer, foto de lo realizado, observaciones y «Realizado». Sin pestañas, compras ni costos.
        const card = page.locator('.task-card').filter({ hasText: 'Cambio de embrague' })
        // Tareas agrupadas por prioridad y botón explícito «Iniciar tarea».
        assert.ok(await page.getByRole('heading', { name: /Prioridad media/ }).count()); checks++
        await card.getByRole('button', { name: 'Iniciar tarea' }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('heading', { name: 'Qué hay que hacer' }).waitFor()
        assert.equal(await dialog.getByRole('tab').count(), 0); checks++
        assert.ok(await dialog.getByRole('button', { name: 'Realizado', exact: true }).isDisabled()); checks++
        // Primero la foto de antes (deja la tarea en trabajo), después la de lo realizado; «Realizado» pide las dos.
        const shoot = async name => { const chooser = page.waitForEvent('filechooser'); await dialog.getByRole('button', { name }).click(); await (await chooser).setFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from('test') }) }
        await shoot('Foto de antes')
        await dialog.locator('.evidence-grid img').first().waitFor()
        assert.ok(writes.some(w => w.endpoint === '/api/tareas/estado/1' && w.body?.estado === 'En_Trabajo')); checks++
        assert.ok(await dialog.getByRole('button', { name: 'Realizado', exact: true }).isDisabled()); checks++
        await shoot('Foto de lo realizado')
        await dialog.locator('.evidence-grid').nth(1).locator('img').first().waitFor()
        // Checklist de salida: obligatorio antes de «Realizado».
        assert.ok(await dialog.getByRole('button', { name: 'Realizado', exact: true }).isDisabled()); checks++
        await dialog.getByRole('button', { name: 'Llenar checklist' }).click()
        await dialog.getByRole('button', { name: 'Marcar lo que falta como «Bien»' }).click()
        await dialog.getByRole('button', { name: 'Guardar checklist' }).click()
        await dialog.getByText('Todos los ítems bien').waitFor(); checks++
        await dialog.getByLabel('Observaciones (opcional)').fill('Se cambió el disco.')
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)); checks++
        await page.screenshot({ path: path.join(output, 'mecanico-detalle-1440.png'), fullPage: false })
        await dialog.getByRole('button', { name: 'Realizado', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        assert.deepEqual(writes.at(-1).body, { estado: 'Completada', observaciones: 'Se cambió el disco.' }); checks++
      }
      if (role === 'encargado') {
        const card = page.locator('.task-card').filter({ hasText: role === 'mecanico' ? 'Cambio de embrague' : 'Cambio de aceite' })
        const open = role === 'mecanico' ? 'Continuar trabajo' : 'Revisar trabajo'
        await card.getByRole('button', { name: open }).click()
        const dialog = page.getByRole('dialog')
        await dialog.locator('.task-steps').waitFor()
        await dialog.getByText('Siguiente paso:').waitFor()
        await page.keyboard.press('Tab')
        assert.ok(await page.evaluate(() => !!document.activeElement.closest('dialog'))); checks++
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        assert.equal(await card.getByRole('button', { name: open }).evaluate(el => el === document.activeElement), true); checks++
        await card.getByRole('button', { name: open }).click()
        // Paso a paso: se abre la sección que necesita acción; el mecánico no ve compras ni costos.
        const tab = name => dialog.getByRole('tab', { name })
        await tab(role === 'mecanico' ? /Después/ : /Revisión/).waitFor()
        assert.equal(await tab(role === 'mecanico' ? /Después/ : /Revisión/).getAttribute('aria-selected'), 'true'); checks++
        if (role === 'mecanico') { assert.equal(await tab(/Costos/).count(), 0); assert.equal(await tab(/Compras/).count(), 0); checks++ }
        if (role === 'mecanico') assert.ok(await dialog.getByRole('button', { name: 'Enviar a revisión' }).isDisabled()), checks++
        const evidenceFile = { name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from('test') }
        if (role === 'mecanico') {
          const chooser = page.waitForEvent('filechooser')
          await dialog.locator('section', { hasText: 'Fotos o video del trabajo terminado' }).getByRole('button', { name: 'Tomar foto' }).click()
          await (await chooser).setFiles(evidenceFile)
          await dialog.locator('.evidence-grid img').first().waitFor(); checks++
        } else {
          // El checklist de salida va en su propia pestaña, no dentro de «Después».
          await tab(/Checklist/).click()
          await dialog.getByRole('heading', { name: 'Checklist de salida' }).waitFor(); checks++
          assert.equal(await dialog.getByText('Checklist de salida').count(), 1)
          await tab(/Costos/).click()
          await dialog.getByText('Total de la tarea').waitFor()
          assert.equal(await dialog.getByText('Boletas y facturas').count(), 0); checks++
          await tab(/Revisión/).click()
        }
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)); checks++
        await page.screenshot({ path: path.join(output, `${role}-detalle-1440.png`), fullPage: false })
        await dialog.getByRole('button', { name: role === 'mecanico' ? 'Enviar a revisión' : 'Aprobar tarea' }).click()
        await dialog.waitFor({ state: 'detached' }); checks++
      }
      if (role === 'jefe') {
        // Las cifras de gasto llevan a Reportes con el período elegido; el nombre del mecánico, a sus tareas.
        await page.getByRole('button', { name: /Gasto del mes/ }).click()
        await page.waitForURL(/#reportes$/)
        assert.equal(await page.getByRole('button', { name: 'Este mes', exact: true }).getAttribute('aria-pressed'), 'true'); checks++
        await page.getByRole('button', { name: 'Ver tareas de Persona de prueba' }).first().click()
        await page.waitForURL(/#tareas$/)
        assert.equal(await page.getByLabel('Buscar tarea, patente o mecánico').inputValue(), 'Persona de prueba'); checks++
        await page.getByLabel('Buscar tarea, patente o mecánico').fill('')
        await page.getByLabel('Desde').fill('')
        await page.getByLabel('Hasta').fill('')
        await page.getByLabel('Desde').fill('2026-09-01')
        await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click()
        await page.getByText('Selecciona un rango de fechas válido.').waitFor(); checks++
        await page.getByLabel('Hasta').fill('2026-09-10')
        const downloaded = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click()
        assert.match((await downloaded).suggestedFilename(), /2026-09-01_2026-09-10/); checks++
      }
      if (role === 'encargado') {
        // Recordatorio de la revisión diaria de inventario y conteo con foto.
        await page.getByText(/falta revisar 1 de 1 ítems esta semana/).waitFor(); checks++
        await page.getByRole('button', { name: 'Ir a revisar ›' }).click()
        await page.waitForURL(/#inventario$/)
        await page.locator('#revision-inventario').getByRole('button', { name: 'Revisar' }).click()
        await page.getByLabel(/Cuántos hay/).fill('18')
        assert.ok(await page.getByRole('button', { name: 'Guardar conteo' }).isDisabled()); checks++
        const countPhoto = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Elegir foto' }).click()
        await (await countPhoto).setFiles({ name: 'aceite.png', mimeType: 'image/png', buffer: Buffer.from('test') })
        await page.getByLabel('Qué pasó (obligatorio)').fill('Se usaron 2 litros sin registrar')
        const counted = page.waitForResponse(r => r.url().endsWith('/api/inventario/revision') && r.request().method() === 'POST')
        await page.getByRole('button', { name: 'Guardar conteo' }).click()
        await counted; checks++
        // «Cotizando» pone en pausa una tarea abierta desde su tarjeta.
        await page.goto(`${base}/#tareas`)
        const paused = page.waitForResponse(r => r.url().endsWith('/api/tareas/2/cotizando'))
        await page.locator('.task-card').filter({ hasText: 'Revisión de frenos' }).getByRole('button', { name: 'Cotizando' }).click()
        await paused
        assert.ok(writes.some(w => w.endpoint === '/api/tareas/2/cotizando' && w.body?.activo === true)); checks++
        // Navegación: la vista vive en la dirección, «Atrás» la deshace y las tarjetas filtran su lista.
        await page.setViewportSize({ width: 1440, height: 950 })
        await page.goto(`${base}/#inventario`)
        await page.getByRole('heading', { name: 'Inventario de repuestos' }).waitFor(); checks++
        await page.getByRole('button', { name: /Sin stock/ }).click()
        await page.getByRole('heading', { name: 'Repuestos sin stock' }).waitFor()
        assert.equal(await page.locator('#inventario tbody tr').count(), 1); checks++
        await page.getByRole('button', { name: 'Ver todos' }).click()
        assert.equal(await page.locator('#inventario tbody tr').count(), 2); checks++
        await page.getByRole('link', { name: 'Combustible' }).click()
        await page.waitForURL(/#combustible$/)
        await page.goBack()
        await page.getByRole('heading', { name: 'Inventario de repuestos' }).waitFor(); checks++
        await page.getByRole('button', { name: /Avisos/ }).click()
        await page.getByRole('button', { name: /Solicitud de compra/ }).click()
        await page.waitForURL(/#compras$/); checks++
        await page.goto(`${base}/#tareas`)
        await page.locator('.task-card').first().waitFor()
        await page.getByRole('button', { name: 'Ver solo las tareas de ABC-123' }).first().click()
        assert.equal(await page.getByLabel('Buscar tarea, patente o mecánico').inputValue(), 'ABC-123'); checks++
        await page.locator('.task-card').first().getByRole('heading').getByRole('button').click()
        await page.getByRole('dialog').waitFor()
        await page.goBack()
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        assert.match(page.url(), /#tareas$/); checks++
      }
      assert.deepEqual(errors, []); checks++
      await page.getByRole('button', { name: 'Salir', exact: true }).click()
      await page.getByRole('button', { name: 'Iniciar Sesión' }).waitFor()
      assert.equal(await page.getByLabel('Contraseña', { exact: true }).inputValue(), ''); checks++
      await page.screenshot({ path: path.join(output, 'login-320.png'), fullPage: true })
      tasks = []
      await page.getByLabel('Email', { exact: true }).fill('prueba@example.test')
      await page.getByLabel('Contraseña', { exact: true }).fill('test-password')
      await page.getByRole('button', { name: 'Iniciar Sesión' }).click()
      await page.getByText(role === 'mecanico' ? 'No tienes tareas asignadas.' : 'No hay tareas registradas todavía.').waitFor(); checks++
      await page.close()
    }
    console.log(`PASS: ${checks} browser assertions across four roles and five viewport widths.`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
