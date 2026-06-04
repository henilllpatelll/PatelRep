/**
 * Web i18n acceptance: unauthenticated users can switch English/Spanish.
 *
 * Covers the language toggle on /login so local verification does not depend on
 * a tenant auth state.
 */
import { test, expect } from '@playwright/test'

test.describe('Language toggle', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('switches login copy between English and Spanish and persists the choice', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => window.localStorage.setItem('patelrep-language', 'en'))
    await page.reload()

    await expect(page.getByRole('heading', { name: /Welcome back to your hotel/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Sign In/i })).toBeEnabled()

    await page.getByRole('button', { name: 'Espanol' }).click()

    await expect(page.getByRole('heading', { name: /Bienvenido de nuevo a tu hotel/i })).toBeVisible()
    await expect(page.getByText('Inicia sesion para mantener el piso avanzando. La IA preparo tu resumen de la manana.')).toBeVisible()
    await expect(page.getByRole('tab', { name: /Iniciar sesion/i })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Olvidaste tu contrasena?' })).toBeVisible()
    await expect(page.getByLabel(/Correo/i)).toBeVisible()
    await expect(page.getByText('Cuartos listos para las 3pm')).toBeVisible()
    await expect(page.getByText('Sandeep R. - Gerente General, Bluebonnet Suites')).toBeVisible()

    await page.reload()

    await expect(page.getByRole('heading', { name: /Bienvenido de nuevo a tu hotel/i })).toBeVisible()

    await page.getByRole('button', { name: 'Ingles' }).click()

    await expect(page.getByRole('heading', { name: /Welcome back to your hotel/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Sign In/i })).toBeVisible()
  })

  test('translates existing and dynamically added program UI phrases', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => window.localStorage.setItem('patelrep-language', 'en'))
    await page.reload()

    await expect(page.getByRole('tab', { name: /Sign In/i })).toBeEnabled()

    await page.evaluate(() => {
      const region = document.createElement('section')
      region.setAttribute('aria-label', 'Program translation sample')
      region.innerHTML = `
        <h2>Housekeeping</h2>
        <button title="Create Work Order" aria-label="Create Work Order">Create Work Order</button>
        <input placeholder="Search rooms, work orders, guests..." />
        <p>Open Work Orders</p>
        <p>AI Copilot</p>
        <p>Save Changes</p>
        <p>Wednesday, June 3</p>
        <p>All done</p>
        <p>all done</p>
        <p>Avg time</p>
        <p>Inspect now</p>
        <p>none</p>
        <p>Full board</p>
        <p>Heads up</p>
        <p>Next 24h</p>
        <p>Heads upNext 24h</p>
        <p>No risk flags right now</p>
        <p>No Riesgo flags right now</p>
        <p>Total Rooms: 12</p>
        <p>Last updated 2 minutes ago</p>
        <p>Showing 1-10 of 42 rooms</p>
        <p>No open work orders</p>
        <p>AI triage</p>
        <p>Room Status Breakdown</p>
        <button aria-label="Open AI Copilot">Ask copilot</button>
        <section role="dialog" aria-label="AI Copilot chat">
          <p>Hi! I'm your AI Copilot. Tell me about a task, ask about operations, or request insights.</p>
          <p>Operations Copilot</p>
          <button>Show GM insights</button>
          <button>Request supplies</button>
          <button>Report issue</button>
          <input placeholder="Room 412 needs towels..." aria-label="Message the AI Copilot" />
          <button aria-label="Send message">Send</button>
        </section>
        <form>
          <p>Report issue</p>
          <label for="feedback-message">Feedback message</label>
          <textarea id="feedback-message" placeholder="Tell me what happened..."></textarea>
          <button aria-label="Send feedback">Sending</button>
        </form>
        <textarea aria-label="Message the AI Copilot" placeholder="Ask anything or create a task..."></textarea>
        <button title="Assign shift to Miguel on Jun 3">Assign Staff</button>
      `
      document.body.appendChild(region)
    })

    await page.getByRole('button', { name: 'Espanol' }).click()

    await expect(page.getByRole('heading', { name: 'Limpieza' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Crear Orden' })).toBeVisible()
    await expect(page.getByPlaceholder('Buscar cuartos, ordenes, huespedes...')).toBeVisible()
    await expect(page.getByText('Ordenes Abiertas', { exact: true })).toBeVisible()
    await expect(page.getByText('Copiloto IA', { exact: true })).toBeVisible()
    await expect(page.getByText('Guardar Cambios')).toBeVisible()
    await expect(page.getByText('miercoles, 3 de junio')).toBeVisible()
    await expect(page.getByText('Todo listo', { exact: true })).toBeVisible()
    await expect(page.getByText('todo listo', { exact: true })).toBeVisible()
    await expect(page.getByText('Tiempo prom.')).toBeVisible()
    await expect(page.getByText('Inspeccionar ahora')).toBeVisible()
    await expect(page.getByText('ninguno')).toBeVisible()
    await expect(page.getByText('Tablero completo')).toBeVisible()
    await expect(page.getByText('Atencion', { exact: true })).toBeVisible()
    await expect(page.getByText('Prox. 24h', { exact: true })).toBeVisible()
    await expect(page.getByText('Atencion Prox. 24h', { exact: true })).toBeVisible()
    await expect(page.getByText('Sin alertas de riesgo ahora')).toHaveCount(2)
    await expect(page.getByText('Total de Cuartos: 12')).toBeVisible()
    await expect(page.getByText('Actualizado hace 2 minutos')).toBeVisible()
    await expect(page.getByText('Mostrando 1-10 de 42 cuartos')).toBeVisible()
    await expect(page.getByText('No hay ordenes abiertas')).toBeVisible()
    await expect(page.getByText('Triaje IA')).toBeVisible()
    await expect(page.getByText('Desglose de estado de cuartos')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abrir Copiloto IA' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Chat del Copiloto IA' })).toBeVisible()
    await expect(page.getByText('Copiloto de Operaciones')).toBeVisible()
    await expect(page.getByText('Mostrar informacion para gerencia')).toBeVisible()
    await expect(page.getByText('Pedir suministros')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reportar problema' })).toBeVisible()
    await expect(page.getByPlaceholder('Cuarto 412 necesita toallas...')).toBeVisible()
    await expect(page.getByLabel('Mensaje de comentarios')).toBeVisible()
    await expect(page.getByPlaceholder('Cuentame que paso...')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enviar comentarios' })).toBeVisible()
    await expect(page.getByLabel('Enviar mensaje al Copiloto IA')).toHaveCount(2)
    await expect(page.getByPlaceholder('Pregunta algo o crea una tarea...')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Asignar Personal' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Asignar Personal' })).toHaveAttribute('title', 'Asignar turno a Miguel el 3 de jun')
    await expect(page.getByText('Total Rooms')).toHaveCount(0)
    await expect(page.getByText('Last updated')).toHaveCount(0)
    await expect(page.getByText('AI triage')).toHaveCount(0)
    await expect(page.getByText('AI Copilot')).toHaveCount(0)
    await expect(page.getByText('Report issue')).toHaveCount(0)
    await expect(page.getByText('Feedback message')).toHaveCount(0)
    await expect(page.getByText('Wednesday')).toHaveCount(0)
    await expect(page.getByText('June')).toHaveCount(0)
    await expect(page.getByText('Avg time')).toHaveCount(0)
    await expect(page.getByText('Inspect now')).toHaveCount(0)
    await expect(page.getByText('Full board')).toHaveCount(0)
    await expect(page.getByText('Heads up')).toHaveCount(0)
    await expect(page.getByText('Heads upNext 24h')).toHaveCount(0)
    await expect(page.getByText('No Riesgo flags right now')).toHaveCount(0)

    await page.getByRole('button', { name: 'Ingles' }).click()

    await expect(page.getByRole('heading', { name: 'Housekeeping' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Work Order' })).toBeVisible()
    await expect(page.getByPlaceholder('Search rooms, work orders, guests...')).toBeVisible()
    await expect(page.getByText('Total Rooms: 12')).toBeVisible()
    await expect(page.getByText('Last updated 2 minutes ago')).toBeVisible()
  })
})
