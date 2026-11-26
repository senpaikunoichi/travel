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
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), endpoint = url.pathname, method = req.method()
        let data = { success: true }, status = 200
        if (failWrite && method !== 'GET') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ mensaje: 'No se pudo guardar el registro de prueba.' }) })
        if (method !== 'GET') writes.push({ endpoint, method, body: req.headers()['content-type']?.includes('json') ? req.postDataJSON() : null })
        if (endpoint === '/api/login') { data = failLogin ? { success: false } : { success: true, usuario: { id: 1, nombre: 'Usuario de prueba', rol: role } }; status = failLogin ? 401 : 200 }
        else if (method === 'GET' && endpoint.startsWith('/api/tareas')) { data.tareas = tasks; if (failLoad) status = 500 }
        else if (endpoint === '/api/mecanicos') data.mecanicos = [{ id: 1, nombre: 'Persona de prueba' }]
        else if (endpoint === '/api/camiones') data.camiones = trucks
        else if (endpoint === '/api/usuarios') data.usuarios = users
        else if (endpoint === '/api/kpis') Object.assign(data, { gastosMes: 1234500, gastosSemana: 123450, totalGastos: 9876500, tareasMecanico: [{ nombre: 'Persona de prueba', total_asignadas: 4, completadas: 2 }] })
        else if (endpoint.startsWith('/api/gastos/') && method === 'GET') data.gastos = expenses
        else if (endpoint.startsWith('/api/evidencia/') && method === 'GET') data.evidencias = evidence
        else if (endpoint.startsWith('/api/tareas/estado/')) tasks = tasks.map(t => t.id === Number(endpoint.split('/').pop()) ? { ...t, estado: req.postDataJSON().estado } : t)
        else if (endpoint === '/api/tareas/crear') tasks.push({ ...req.postDataJSON(), id: 8, estado: 'Pendiente' })
        else if (endpoint === '/api/camiones/agregar') trucks.push(req.postDataJSON())
        else if (endpoint.startsWith('/api/camiones/editar/')) trucks = trucks.map(t => t.patente === decodeURIComponent(endpoint.split('/').pop()) ? { ...t, ...req.postDataJSON() } : t)
        else if (endpoint === '/api/usuarios/agregar') users.push({ ...req.postDataJSON(), id: 2 })
        else if (endpoint.startsWith('/api/usuarios/editar/')) users = users.map(u => u.id === Number(endpoint.split('/').pop()) ? { ...u, ...req.postDataJSON() } : u)
        else if (endpoint === '/api/gastos/agregar') expenses.push({ id: expenses.length + 1, ...req.postDataJSON() })
        else if (endpoint.includes('/api/evidencia/subir/') || endpoint.includes('/api/evidencia/factura/')) evidence.push({ id: evidence.length + 1, tipo: endpoint.includes('/factura/') ? 'factura' : 'foto', ruta_archivo: '/logo-travel.png' })
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
      await page.getByRole('navigation').getByRole('link', { name: 'Tareas', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded'), 'false'); checks++
      await page.getByLabel('Buscar tarea o patente').fill('sin coincidencia')
      await page.getByText('No hay tareas que coincidan con los filtros.').waitFor(); checks++
      await page.getByLabel('Buscar tarea o patente').fill('')
      await page.getByLabel('Estado', { exact: true }).selectOption('Completada')
      await page.getByText('1 de 4 tareas').waitFor(); checks++
      await page.getByLabel('Estado', { exact: true }).selectOption('')
      if (role === 'admin' || role === 'encargado') {
        await page.getByRole('button', { name: '+ Nueva tarea', exact: true }).click()
        await page.getByLabel('Tipo de tarea').fill('Prueba de creación')
        await page.getByLabel('Camión', { exact: true }).selectOption('ABC-123')
        await page.getByLabel('Fecha límite').fill('2026-09-20')
        await page.getByRole('button', { name: 'Guardar', exact: true }).click()
        await page.getByText('Selecciona al menos un mecánico.').waitFor()
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Guardar', exact: true }).click()
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
      if (role === 'mecanico' || role === 'encargado') {
        const card = page.locator('.task-card').filter({ hasText: role === 'mecanico' ? 'Cambio de embrague' : 'Cambio de aceite' })
        if (role === 'mecanico') { await card.getByRole('button', { name: 'Iniciar tarea' }).click(); checks++ }
        await card.getByRole('button', { name: 'Ver detalle' }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByText('No hay evidencias registradas.').waitFor()
        await page.keyboard.press('Tab')
        assert.ok(await page.evaluate(() => !!document.activeElement.closest('dialog'))); checks++
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        assert.equal(await card.getByRole('button', { name: 'Ver detalle' }).evaluate(el => el === document.activeElement), true); checks++
        await card.getByRole('button', { name: 'Ver detalle' }).click()
        await dialog.getByLabel(role === 'mecanico' ? 'Foto de evidencia' : 'Boleta o factura').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from('test') })
        await dialog.getByRole('button', { name: role === 'mecanico' ? 'Subir foto' : 'Subir documento' }).click()
        await dialog.getByText('Archivo subido correctamente.').waitFor(); checks++
        if (role === 'mecanico') {
          await dialog.getByLabel('Concepto', { exact: true }).fill('Filtro')
          await dialog.getByLabel('Monto ($)', { exact: true }).fill('12345')
          await dialog.getByRole('button', { name: 'Agregar gasto' }).click()
          await dialog.getByRole('cell', { name: 'Filtro', exact: true }).waitFor(); checks++
        }
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)); checks++
        await page.screenshot({ path: path.join(output, `${role}-detalle-320.png`), fullPage: true })
        await dialog.getByRole('button', { name: role === 'mecanico' ? 'Marcar como completada' : 'Aprobar tarea' }).click()
        await dialog.waitFor({ state: 'detached' }); checks++
      }
      if (role === 'jefe') {
        await page.getByLabel('Desde').fill('2026-09-01')
        await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click()
        await page.getByText('Selecciona un rango de fechas válido.').waitFor(); checks++
        await page.getByLabel('Hasta').fill('2026-09-10')
        const downloaded = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click()
        assert.match((await downloaded).suggestedFilename(), /2026-09-01_2026-09-10/); checks++
      }
      assert.deepEqual(errors, []); checks++
      await page.getByRole('button', { name: 'Cerrar sesión' }).click()
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
