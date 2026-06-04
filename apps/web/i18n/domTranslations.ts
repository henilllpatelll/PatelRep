import en from '@/i18n/locales/en'
import es from '@/i18n/locales/es'
import type { AppLanguage } from '@/i18n'

const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'placeholder', 'title'] as const
const TEXT_SKIP_SELECTOR = 'script, style, code, pre, textarea, [data-i18n-skip="true"]'
const ATTRIBUTE_SKIP_SELECTOR = 'script, style, code, pre, [data-i18n-skip="true"]'

const textOriginals = new WeakMap<Text, string>()
const attrOriginals = new WeakMap<Element, Map<string, string>>()

const PHRASE_TRANSLATIONS: Record<string, string> = {
  // Common actions
  'Add': 'Agregar',
  'Add Note': 'Agregar Nota',
  'Add Photo': 'Agregar Foto',
  'Apply': 'Aplicar',
  'Approve': 'Aprobar',
  'Archive': 'Archivar',
  'Assign': 'Asignar',
  'Assigned': 'Asignado',
  'Back': 'Volver',
  'Cancel': 'Cancelar',
  'Claim': 'Tomar',
  'Clear': 'Limpiar',
  'Close': 'Cerrar',
  'Complete': 'Completar',
  'Confirm': 'Confirmar',
  'Create': 'Crear',
  'Creating': 'Creando',
  'Create Task': 'Crear Tarea',
  'Create Work Order': 'Crear Orden',
  'Delete': 'Eliminar',
  'Download': 'Descargar',
  'Edit': 'Editar',
  'Export': 'Exportar',
  'Filter': 'Filtrar',
  'Import': 'Importar',
  'Invite': 'Invitar',
  'Mark Complete': 'Marcar Completo',
  'Mark Clean': 'Marcar Limpio',
  'Next': 'Siguiente',
  'Open': 'Abierto',
  'Refresh': 'Actualizar',
  'Remove': 'Quitar',
  'Reopen': 'Reabrir',
  'Reset': 'Restablecer',
  'Retry': 'Reintentar',
  'Save': 'Guardar',
  'Save Changes': 'Guardar Cambios',
  'Search': 'Buscar',
  'Send': 'Enviar',
  'Submit': 'Enviar',
  'Upload': 'Subir',
  'View': 'Ver',

  // Login and shell copy
  'Operator sign in': 'Ingreso de operador',
  'Welcome back to your hotel.': 'Bienvenido de nuevo a tu hotel.',
  'Sign in to keep the floor running smoothly. The AI has prepared your morning briefing.': 'Inicia sesion para mantener el piso avanzando. La IA preparo tu resumen de la manana.',
  'Sign In': 'Iniciar sesion',
  'Magic Link': 'Enlace magico',
  'Forgot password?': 'Olvidaste tu contrasena?',
  'Rooms ready by 3pm': 'Cuartos listos para las 3pm',
  "It's like having a second supervisor on the floor - quietly catching the things we'd miss.": 'Es como tener otro supervisor en el piso, tranquilo y atento a lo que se nos puede pasar.',
  'Sandeep R. - GM, Bluebonnet Suites': 'Sandeep R. - Gerente General, Bluebonnet Suites',

  // Common states
  'Active': 'Activo',
  'All': 'Todos',
  'Available': 'Disponible',
  'Closed': 'Cerrado',
  'Completed': 'Completado',
  'Critical': 'Critico',
  'Draft': 'Borrador',
  'Emergency': 'Emergencia',
  'Empty': 'Vacio',
  'Error': 'Error',
  'Error ID': 'ID de Error',
  'Excellent': 'Excelente',
  'Failed': 'Fallido',
  'High': 'Alta',
  'In Progress': 'En Progreso',
  'Inactive': 'Inactivo',
  'Inspected': 'Inspeccionado',
  'Loading': 'Cargando',
  'Loading...': 'Cargando...',
  'Low': 'Baja',
  'Medium': 'Media',
  'Normal': 'Normal',
  'No matching command': 'Sin resultados',
  'Offline': 'Sin Conexion',
  'Online': 'En Linea',
  'Open Tasks': 'Tareas Abiertas',
  'Open Work Orders': 'Ordenes Abiertas',
  'Pending': 'Pendiente',
  'Ready': 'Listo',
  'Required': 'Requerido',
  'Resolved': 'Resuelto',
  'Urgent': 'Urgente',

  // Global navigation and shell
  'AI Copilot': 'Copiloto IA',
  'All Rooms': 'Todos los Cuartos',
  'Assets': 'Activos',
  'Billing': 'Facturacion',
  'Dashboard': 'Panel',
  'Engineering': 'Mantenimiento',
  'Feedback': 'Comentarios',
  'Front Desk': 'Recepcion',
  'General': 'General',
  'Guest Requests': 'Solicitudes',
  'Go to Dashboard': 'Ir al Panel',
  'Home': 'Inicio',
  'Hotel Operations AI': 'IA Operativa Hotelera',
  'Hotel AI': 'IA Hotelera',
  'Housekeeping': 'Limpieza',
  'Inspections': 'Inspecciones',
  'Integrations': 'Integraciones',
  'Logbook': 'Bitacora',
  'Lost & Found': 'Objetos Perdidos',
  'My Rooms': 'Mis Cuartos',
  'Notifications': 'Notificaciones',
  'Onboarding': 'Configuracion Inicial',
  'Organization': 'Organizacion',
  'PM Schedules': 'PM Programado',
  'Predictions': 'Predicciones',
  'Reports': 'Reportes',
  'Roles': 'Roles',
  'Rooms': 'Cuartos',
  'Schedule': 'Horario',
  'Scheduling': 'Programacion',
  'Settings': 'Configuracion',
  'SOP Library': 'Biblioteca SOP',
  'Staff': 'Personal',
  'Tasks': 'Tareas',
  'Work Orders': 'Ordenes',

  // Housekeeping
  'Add Room Note': 'Agregar Nota del Cuarto',
  'Assignment Mode': 'Modo de Asignacion',
  'Assignments': 'Asignaciones',
  'Checkout': 'Salida',
  'Check-in': 'Entrada',
  'Clean': 'Limpio',
  'Clean ready for inspection': 'Limpio, listo para inspeccion',
  'Daily Board': 'Tablero Diario',
  'Departure': 'Salida',
  'Dirty': 'Sucio',
  'Do Not Disturb': 'No Molestar',
  'Done': 'Listo',
  'Due Out': 'Sale Hoy',
  'Floor': 'Piso',
  'Full Service': 'Servicio Completo',
  'Housekeeper': 'Camarista',
  'Housekeeping Board': 'Tablero de Limpieza',
  'Inspection': 'Inspeccion',
  'Inspection Templates': 'Plantillas de Inspeccion',
  'Inspected / Ready': 'Inspeccionado / Listo',
  'Light Service': 'Servicio Ligero',
  'No rooms assigned': 'Sin cuartos asignados',
  'Occupied': 'Ocupado',
  'Occupied Dirty': 'Ocupado Sucio',
  'Out of Order': 'Fuera de Orden',
  'Out of Order / Out of Service': 'Fuera de Orden / Fuera de Servicio',
  'Out of Service': 'Fuera de Servicio',
  'Pickup': 'Recogida',
  'Pickup - Full': 'Recogida - Completa',
  'Pickup - Light': 'Recogida - Ligera',
  'Ready for Inspection': 'Listo para Inspeccion',
  'Ready Occupied': 'Listo Ocupado',
  'Ready Vacant': 'Listo Vacante',
  'Room': 'Cuarto',
  'Room Board': 'Tablero de Cuartos',
  'Room Details': 'Detalles del Cuarto',
  'Room Status': 'Estado del Cuarto',
  'Room Type': 'Tipo de Cuarto',
  'Rooms Ready': 'Cuartos Listos',
  'Rooms today': 'Cuartos hoy',
  'Start Cleaning': 'Empezar Limpieza',
  'Stayover': 'Estadia',
  'Supervisor': 'Supervisor',
  'To Inspect': 'Por Inspeccionar',
  'Total': 'Total',
  'Total Rooms': 'Total de Cuartos',
  'Vacant': 'Vacante',
  'Vacant Dirty': 'Vacante Sucio',
  'VIP Guest': 'Huesped VIP',
  'All done': 'Todo listo',
  'all done': 'todo listo',
  'Avg time': 'Tiempo prom.',
  'Inspect now': 'Inspeccionar ahora',
  'none': 'ninguno',
  'Full board': 'Tablero completo',
  'My queue': 'Mi lista',
  'Heads up': 'Atencion',
  'Next 24h': 'Prox. 24h',
  'Heads upNext 24h': 'Atencion Prox. 24h',
  'Heads up Next 24h': 'Atencion Prox. 24h',
  'No risk flags right now': 'Sin alertas de riesgo ahora',
  'No Risk flags right now': 'Sin alertas de riesgo ahora',
  'No Riesgo flags right now': 'Sin alertas de riesgo ahora',
  'No rooms assigned for today': 'Sin cuartos asignados para hoy',
  'now': 'ahora',
  'next up': 'siguiente',
  'flex': 'flexible',
  'pending': 'pendiente',

  // Engineering
  'Asset': 'Activo',
  'Asset Category': 'Categoria de Activo',
  'Asset Details': 'Detalles del Activo',
  'Assets & PM': 'Activos y PM',
  'Chief Engineer': 'Jefe de Mantenimiento',
  'Completion Notes': 'Notas de Cierre',
  'Create Asset': 'Crear Activo',
  'Create PM Schedule': 'Crear PM Programado',
  'Failure Prediction': 'Prediccion de Falla',
  'Failure Predictions': 'Predicciones de Falla',
  'Maintenance': 'Mantenimiento',
  'Maintenance Tech': 'Tecnico de Mantenimiento',
  'No open work orders': 'No hay ordenes abiertas',
  'PM Schedule': 'PM Programado',
  'Preventive Maintenance': 'Mantenimiento Preventivo',
  'Priority': 'Prioridad',
  'Submit Work Order': 'Enviar Orden',
  'Work Order': 'Orden',
  'Work Order Details': 'Detalles de la Orden',

  // Guest requests, tasks, logbook, lost and found
  'Activity': 'Actividad',
  'Category': 'Categoria',
  'Claimed': 'Reclamado',
  'Comments': 'Comentarios',
  'Description': 'Descripcion',
  'Due Date': 'Fecha Limite',
  'Guest': 'Huesped',
  'Guest Name': 'Nombre del Huesped',
  'History': 'Historial',
  'Item': 'Objeto',
  'Location': 'Ubicacion',
  'Log Entry': 'Entrada de Bitacora',
  'New Request': 'Nueva Solicitud',
  'Notes': 'Notas',
  'Owner': 'Responsable',
  'Reported': 'Reportado',
  'Request': 'Solicitud',
  'Requests': 'Solicitudes',
  'Status': 'Estado',
  'Task': 'Tarea',
  'Title': 'Titulo',

  // Staff, reports, billing, settings
  'AI Usage': 'Uso de IA',
  'Analytics': 'Analitica',
  'Cap': 'Limite',
  'Credits': 'Creditos',
  'Daily Summary': 'Resumen Diario',
  'Department': 'Departamento',
  'Departments': 'Departamentos',
  'Email': 'Correo',
  'General Manager': 'Gerente General',
  'Hotel Profile': 'Perfil del Hotel',
  'Invitations': 'Invitaciones',
  'Last updated': 'Actualizado',
  'Monthly': 'Mensual',
  'Name': 'Nombre',
  'Plan': 'Plan',
  'Profile': 'Perfil',
  'Revenue': 'Ingresos',
  'Role': 'Rol',
  'Staff Member': 'Miembro del Personal',
  'Subscription': 'Suscripcion',
  'Team': 'Equipo',
  'Today': 'Hoy',
  'Usage': 'Uso',
  'Week': 'Semana',
  'WO Completion': 'Cierre de Ordenes',

  // AI and SOP
  'AI Risk Alerts': 'Alertas de Riesgo IA',
  'AI risk': 'Riesgo IA',
  'Ask AI': 'Preguntar a IA',
  'Ask copilot': 'Preguntar al copiloto',
  'Ask anything or create a task...': 'Pregunta algo o crea una tarea...',
  'Confirm & Create': 'Confirmar y Crear',
  'Create this task?': 'Crear esta tarea?',
  'Document': 'Documento',
  'Documents': 'Documentos',
  'Procedure': 'Procedimiento',
  'Procedures': 'Procedimientos',
  'Search procedures': 'Buscar procedimientos',
  'Thinking...': 'Pensando...',

  // System and fallback pages
  'An unexpected error occurred. Please try refreshing the page.': 'Ocurrio un error inesperado. Intenta actualizar la pagina.',
  'Clean Inspect': 'Limpio para Inspeccion',
  'Display preferences': 'Preferencias de pantalla',
  'Good afternoon': 'Buenas tardes',
  'Good evening': 'Buenas noches',
  'Good morning': 'Buenos dias',
  'Last action': 'Ultima accion',
  'No active alerts - operations running smoothly': 'Sin alertas activas - operaciones funcionando bien',
  'No active alerts â€” operations running smoothly': 'Sin alertas activas - operaciones funcionando bien',
  'Open feedback': 'Abrir comentarios',
  'Page Not Found': 'Pagina No Encontrada',
  'Real-time': 'Tiempo real',
  'Room status': 'Estado de cuartos',
  'Rooms Inspected': 'Cuartos Inspeccionados',
  'SLA Breaches': 'Incumplimientos SLA',
  'SLA Compliance (30 days)': 'Cumplimiento SLA (30 dias)',
  'Something went wrong': 'Algo salio mal',
  'Tasks Completed': 'Tareas Completadas',
  "The page you're looking for doesn't exist or has been moved.": 'La pagina que buscas no existe o fue movida.',
  'This morning - 9:42': 'Esta manana - 9:42',
  'Top Staff Performers (30 days)': 'Mejor Personal (30 dias)',
  'Total WOs': 'Total de Ordenes',
  'Try Again': 'Intentar de Nuevo',
  'Avg Resolution': 'Resolucion Promedio',
}

Object.assign(PHRASE_TRANSLATIONS, {
  Action: 'Accion',
  Actions: 'Acciones',
  'Add Entry': 'Agregar Entrada',
  'Add Manually': 'Agregar Manualmente',
  'Add first entry': 'Agregar primera entrada',
  'Assign Staff': 'Asignar Personal',
  'Assign mode': 'Modo de asignacion',
  'By Staff': 'Por Personal',
  'Create Shift': 'Crear Turno',
  'Track': 'Dar seguimiento',
  'No high-risk assets': 'Sin activos de alto riesgo',
  'No open orders': 'Sin ordenes abiertas',
  'No in progress orders': 'Sin ordenes en progreso',
  'No requests': 'Sin solicitudes',
  'No items found': 'Sin objetos encontrados',
  AI: 'IA',
  Operations: 'Operaciones',
  'Settings navigation': 'Navegacion de configuracion',
  'Inspection Queue': 'Cola de Inspeccion',
  'Inspect cleaned rooms - pass, flag conditional, or send back for re-clean.': 'Inspecciona cuartos limpios: aprueba, marca condicional o envia a relimpiar.',
  'Inspect cleaned rooms — pass, flag conditional, or send back for re-clean.': 'Inspecciona cuartos limpios: aprueba, marca condicional o envia a relimpiar.',
  'Inspected Vacant': 'Inspeccionado Vacante',
  'Ready to Strip': 'Listo para Desvestir',
  'Room status board': 'Tablero de estado de cuartos',
  'All assets are within normal risk levels.': 'Todos los activos estan dentro de niveles normales de riesgo.',
  'Predictions updated nightly by AI': 'Predicciones actualizadas cada noche por IA',
  'Guest handoff': 'Entrega de huesped',
  'Track and resolve guest service requests': 'Da seguimiento y resuelve solicitudes de servicio de huespedes',
  'Hotel Name': 'Nombre del Hotel',
  'Log Found Item': 'Registrar Objeto Encontrado',
  'Manage shift assignments and view weekly coverage': 'Administra asignaciones de turno y revisa la cobertura semanal',
  'Manage your hotel profile and configuration.': 'Administra el perfil y la configuracion de tu hotel.',
  'Staff Performance': 'Desempeno del Personal',
  'Staff Scheduling': 'Programacion del Personal',
  "Today's AI Shift Summary": 'Resumen de Turno IA de Hoy',
  "Today's Roster": 'Lista de Hoy',
  'AC issues this week': 'Problemas de aire acondicionado esta semana',
  'AI triage': 'Triaje IA',
  'AI queries': 'consultas de IA',
  'At-risk rooms today': 'Cuartos en riesgo hoy',
  Copilot: 'Copiloto',
  'Credit usage': 'Uso de creditos',
  "Upload your hotel's standard operating procedures to make them searchable with AI.": 'Sube los procedimientos operativos estandar del hotel para que se puedan buscar con IA.',
  'Import rooms': 'Importar cuartos',
  'No lost & found items logged yet.': 'Aun no hay objetos perdidos registrados.',
  'No active alerts — operations running smoothly': 'Sin alertas activas - operaciones funcionando bien',
  'No staff scheduled for today yet.': 'Aun no hay personal programado para hoy.',
  'Add the first entry for today to keep your team informed.': 'Agrega la primera entrada de hoy para mantener informado al equipo.',
  'Open AI Copilot': 'Abrir Copiloto IA',
  'Scrollable weekly schedule table': 'Tabla semanal desplazable',
  'Search lost and found items': 'Buscar objetos perdidos',
  'Search by description...': 'Buscar por descripcion...',
  'Search by name or email...': 'Buscar por nombre o correo...',
  'Search by name or email…': 'Buscar por nombre o correo...',
  'Search room...': 'Buscar cuarto...',
  'Filter by type': 'Filtrar por tipo',
  'Filter by priority': 'Filtrar por prioridad',
  'Assigned To': 'Asignado a',
  'Breakdown': 'Desglose',
  'Delete room': 'Eliminar cuarto',
  'Message the AI Copilot': 'Enviar mensaje al Copiloto IA',
  'Room Status Breakdown': 'Desglose de estado de cuartos',
  'Status Breakdown': 'Desglose de estado',
  'AI Copilot chat': 'Chat del Copiloto IA',
  'AI Copilot conversation': 'Conversacion del Copiloto IA',
  'PatelRep AI': 'PatelRep IA',
  'Operations Copilot': 'Copiloto de Operaciones',
  "Hi! I'm your AI Copilot. Tell me about a task, ask about operations, or request insights.": 'Hola. Soy tu Copiloto IA. Cuentame sobre una tarea, pregunta por operaciones o pide informacion.',
  "Hi! I'm your AI Copilot. Ask anything about your hotel â€” rooms, staff, work orders, history. Grounded on your data, citing sources.": 'Hola. Soy tu Copiloto IA. Pregunta cualquier cosa sobre tu hotel: cuartos, personal, ordenes o historial. Respondo con tus datos y fuentes.',
  "I've processed your request.": 'Procese tu solicitud.',
  'Something went wrong. Please try again.': 'Algo salio mal. Intentalo de nuevo.',
  'No problem â€” cancelled.': 'Sin problema. Cancelado.',
  'Creating...': 'Creando...',
  'Creatingâ€¦': 'Creando...',
  'Confirm & Create': 'Confirmar y Crear',
  'Suggested actions': 'Acciones sugeridas',
  'Show GM insights': 'Mostrar informacion para gerencia',
  'Open work orders': 'Ordenes abiertas',
  'Assign rooms': 'Asignar cuartos',
  'Open tasks': 'Tareas abiertas',
  'Asset risk alerts': 'Alertas de riesgo de activos',
  'Overdue PMs': 'PM atrasados',
  'My tasks today': 'Mis tareas de hoy',
  'Request supplies': 'Pedir suministros',
  'Report issue': 'Reportar problema',
  'My work orders': 'Mis ordenes',
  'Report repair': 'Reportar reparacion',
  'Mark complete': 'Marcar completo',
  'Guest request': 'Solicitud de huesped',
  'Create task': 'Crear tarea',
  'Room 412 needs towelsâ€¦': 'El cuarto 412 necesita toallas...',
  'What needs attention right now?': 'Que necesita atencion ahora?',
  'Send message': 'Enviar mensaje',
  'Clear': 'Limpiar',
  'Examples': 'Ejemplos',
  'Try one': 'Prueba uno',
  'Recent': 'Reciente',
  'Model': 'Modelo',
  'Show me checkouts running late': 'Muestrame salidas atrasadas',
  'Which rooms need to be ready by 3pm?': 'Que cuartos deben estar listos para las 3pm?',
  'Reassign remaining rooms': 'Reasignar cuartos restantes',
  'Cost of reactive vs preventive': 'Costo de reactivo vs preventivo',
  'Reassign late checkouts': 'Reasignar salidas atrasadas',
  'Quarterly PM plan': 'Plan PM trimestral',
  'Linen par tonight': 'Par de lenceria esta noche',
  'of cap': 'del limite',
  'Send feedback': 'Enviar comentarios',
  'Close feedback': 'Cerrar comentarios',
  'Feedback message': 'Mensaje de comentarios',
  'Tell me what happened...': 'Cuentame que paso...',
  'Sending': 'Enviando',
  'Send': 'Enviar',
} satisfies Record<string, string>)

const GLOSSARY_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bOpen AI Copilot\b/gi, 'Abrir Copiloto IA'],
  [/\bMessage the AI Copilot\b/gi, 'Enviar mensaje al Copiloto IA'],
  [/\bAI Copilot\b/gi, 'Copiloto IA'],
  [/\bAI Shift Summary\b/gi, 'Resumen de Turno IA'],
  [/\bAI Risk Alerts\b/gi, 'Alertas de Riesgo IA'],
  [/\bAI triage\b/gi, 'Triaje IA'],
  [/\bAI queries\b/gi, 'consultas de IA'],
  [/\bAI\b/g, 'IA'],
  [/\bAsk\b/gi, 'Preguntar'],
  [/\bShow\b/gi, 'Mostrar'],
  [/\bInsights\b/gi, 'Informacion'],
  [/\bCopilot\b/gi, 'Copiloto'],
  [/\bOpen\b/gi, 'Abrir'],
  [/\bClose\b/gi, 'Cerrar'],
  [/\bCreate\b/gi, 'Crear'],
  [/\bCancel\b/gi, 'Cancelar'],
  [/\bSave\b/gi, 'Guardar'],
  [/\bSubmit\b/gi, 'Enviar'],
  [/\bSearch\b/gi, 'Buscar'],
  [/\bFilter\b/gi, 'Filtrar'],
  [/\bRefresh\b/gi, 'Actualizar'],
  [/\bExport\b/gi, 'Exportar'],
  [/\bImport\b/gi, 'Importar'],
  [/\bAdd\b/gi, 'Agregar'],
  [/\bEdit\b/gi, 'Editar'],
  [/\bDelete\b/gi, 'Eliminar'],
  [/\bAssign shift to\b/gi, 'Asignar turno a'],
  [/\bAssign\b/gi, 'Asignar'],
  [/\bAssigned To\b/gi, 'Asignado a'],
  [/\bAssigned\b/gi, 'Asignado'],
  [/\bUnassigned\b/gi, 'Sin asignar'],
  [/\bDashboard\b/gi, 'Panel'],
  [/\bHousekeeping\b/gi, 'Limpieza'],
  [/\bEngineering\b/gi, 'Mantenimiento'],
  [/\bWork Orders\b/gi, 'Ordenes'],
  [/\bGuest Requests\b/gi, 'Solicitudes'],
  [/\bTasks\b/gi, 'Tareas'],
  [/\bReports\b/gi, 'Reportes'],
  [/\bLogbook\b/gi, 'Bitacora'],
  [/\bStaff\b/gi, 'Personal'],
  [/\bSchedule\b/gi, 'Horario'],
  [/\bSettings\b/gi, 'Configuracion'],
  [/\bOperations\b/gi, 'Operaciones'],
  [/\bIntelligence\b/gi, 'Inteligencia'],
  [/\bOrganization\b/gi, 'Organizacion'],
  [/\bRoom status\b/gi, 'Estado de cuartos'],
  [/\bStatus Breakdown\b/gi, 'Desglose de estado'],
  [/\bBreakdown\b/gi, 'Desglose'],
  [/\bRooms\b/gi, 'Cuartos'],
  [/\bRoom\b/gi, 'Cuarto'],
  [/\bneeds towels\b/gi, 'necesita toallas'],
  [/\bTotal\b/gi, 'Total'],
  [/\bReady\b/gi, 'Listo'],
  [/\bDirty\b/gi, 'Sucio'],
  [/\bClean\b/gi, 'Limpio'],
  [/\bInspected\b/gi, 'Inspeccionado'],
  [/\bIn Progress\b/gi, 'En Progreso'],
  [/\bPickup\b/gi, 'Recogida'],
  [/\bOccupied\b/gi, 'Ocupado'],
  [/\bVacant\b/gi, 'Vacante'],
  [/\bOut of Order\b/gi, 'Fuera de Orden'],
  [/\bOut of Service\b/gi, 'Fuera de Servicio'],
  [/\bInspections\b/gi, 'Inspecciones'],
  [/\bInspection\b/gi, 'Inspeccion'],
  [/\bAssignments\b/gi, 'Asignaciones'],
  [/\bAssignment\b/gi, 'Asignacion'],
  [/\bRisk\b/gi, 'Riesgo'],
  [/\bAlerts\b/gi, 'Alertas'],
  [/\bLoading\b/gi, 'Cargando'],
  [/\bThis week\b/gi, 'Esta semana'],
  [/\bToday\b/gi, 'Hoy'],
  [/\bWeek\b/gi, 'Semana'],
  [/\bMonth\b/gi, 'Mes'],
  [/\bStatus\b/gi, 'Estado'],
  [/\bPriority\b/gi, 'Prioridad'],
  [/\bCategory\b/gi, 'Categoria'],
  [/\bDescription\b/gi, 'Descripcion'],
  [/\bTitle\b/gi, 'Titulo'],
  [/\bNotes\b/gi, 'Notas'],
  [/\bGuest\b/gi, 'Huesped'],
  [/\bHistory\b/gi, 'Historial'],
  [/\bActivity\b/gi, 'Actividad'],
  [/\bOwner\b/gi, 'Responsable'],
  [/\bEmail\b/gi, 'Correo'],
  [/\bRole\b/gi, 'Rol'],
  [/\bName\b/gi, 'Nombre'],
  [/\bDepartment\b/gi, 'Departamento'],
  [/\bChief\b/gi, 'Jefe'],
  [/\bManager\b/gi, 'Gerente'],
  [/\bHousekeeper\b/gi, 'Camarista'],
  [/\bEngineer\b/gi, 'Tecnico'],
  [/\bFront Desk\b/gi, 'Recepcion'],
  [/\bService\b/gi, 'Servicio'],
  [/\bRecovery\b/gi, 'Recuperacion'],
  [/\bRequests\b/gi, 'Solicitudes'],
  [/\bRequest\b/gi, 'Solicitud'],
  [/\bLost\b/gi, 'Perdidos'],
  [/\bFound\b/gi, 'Encontrados'],
  [/\bBilling\b/gi, 'Facturacion'],
  [/\bSubscription\b/gi, 'Suscripcion'],
  [/\bUsage\b/gi, 'Uso'],
  [/\bCredits\b/gi, 'Creditos'],
  [/\bProfile\b/gi, 'Perfil'],
  [/\bPassword\b/gi, 'Contrasena'],
  [/\bLanguage\b/gi, 'Idioma'],
  [/\bNotifications\b/gi, 'Notificaciones'],
  [/\bCommand\b/gi, 'Comando'],
  [/\bFeedback\b/gi, 'Comentarios'],
  [/\bReport issue\b/gi, 'Reportar problema'],
  [/\bTell me\b/gi, 'Cuentame'],
  [/\bSending\b/gi, 'Enviando'],
  [/\bSend message\b/gi, 'Enviar mensaje'],
  [/\bSomething went wrong\b/gi, 'Algo salio mal'],
  [/\bTry again\b/gi, 'Intentalo de nuevo'],
  [/\bExamples\b/gi, 'Ejemplos'],
  [/\bRecent\b/gi, 'Reciente'],
  [/\bClear\b/gi, 'Limpiar'],
  [/\bSuggested actions\b/gi, 'Acciones sugeridas'],
  [/\bModel\b/gi, 'Modelo'],
  [/\bJun\b/g, 'jun'],
  [/\bon jun\b/gi, 'el jun'],
]

const WEEKDAY_TRANSLATIONS: Record<string, string> = {
  sunday: 'domingo',
  monday: 'lunes',
  tuesday: 'martes',
  wednesday: 'miercoles',
  thursday: 'jueves',
  friday: 'viernes',
  saturday: 'sabado',
}

const MONTH_TRANSLATIONS: Record<string, string> = {
  january: 'enero',
  february: 'febrero',
  march: 'marzo',
  april: 'abril',
  may: 'mayo',
  june: 'junio',
  july: 'julio',
  august: 'agosto',
  september: 'septiembre',
  october: 'octubre',
  november: 'noviembre',
  december: 'diciembre',
}

const ATTRIBUTE_TRANSLATIONS: Record<string, string> = {
  ...PHRASE_TRANSLATIONS,
  'Search rooms, work orders, guests...': 'Buscar cuartos, ordenes, huespedes...',
  'Search rooms, work orders, guests…': 'Buscar cuartos, ordenes, huespedes...',
  'Search rooms': 'Buscar cuartos',
  'Search work orders': 'Buscar ordenes',
  'Search staff': 'Buscar personal',
  'Search tasks': 'Buscar tareas',
}

const REGEX_TRANSLATIONS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s+(\d{4}))?$/i, (match) => {
    const weekday = WEEKDAY_TRANSLATIONS[match[1].toLowerCase()]
    const month = MONTH_TRANSLATIONS[match[2].toLowerCase()]
    const year = match[4] ? ` de ${match[4]}` : ''
    return weekday && month ? `${weekday}, ${match[3]} de ${month}${year}` : match[0]
  }],
  [/^Total Rooms:\s*(\d+)$/i, (match) => `Total de Cuartos: ${match[1]}`],
  [/^Last updated\s+(\d+)\s+minutes?\s+ago$/i, (match) => `Actualizado hace ${match[1]} ${match[1] === '1' ? 'minuto' : 'minutos'}`],
  [/^Showing\s+(.+?)\s+of\s+(.+?)\s+rooms$/i, (match) => `Mostrando ${match[1]} de ${match[2]} cuartos`],
  [/^No\s+open\s+work\s+orders$/i, () => 'No hay ordenes abiertas'],
  [/^Good\s+(morning|afternoon|evening),\s+(.+)\.$/i, (match) => {
    const greeting = match[1].toLowerCase() === 'morning'
      ? 'Buenos dias'
      : match[1].toLowerCase() === 'afternoon'
      ? 'Buenas tardes'
      : 'Buenas noches'
    return `${greeting}, ${match[2]}.`
  }],
  [/^Assign shift to\s*(.*?)\s+on\s+Jun\s+(\d+)$/i, (match) => {
    const name = match[1].trim()
    return `Asignar turno${name ? ` a ${name}` : ''} el ${match[2]} de jun`
  }],
  [/^(\d+)\s+tasks?\s+created\.$/i, (match) => `${match[1]} ${match[1] === '1' ? 'tarea creada' : 'tareas creadas'}.`],
  [/^(\d+)\s+work orders?\s+created\.$/i, (match) => `${match[1]} ${match[1] === '1' ? 'orden creada' : 'ordenes creadas'}.`],
  [/^(\d+)\s+guest requests?\s+logged\.$/i, (match) => `${match[1]} ${match[1] === '1' ? 'solicitud registrada' : 'solicitudes registradas'}.`],
  [/^(\d+)\s+rooms\s+total$/i, (match) => `${match[1]} cuartos total`],
  [/^(\d+)\s+rooms$/i, (match) => `${match[1]} cuartos`],
  [/^Room\s+(.+)$/i, (match) => `Cuarto ${translatePhrase(match[1], PHRASE_TRANSLATIONS).trim()}`],
  [/^Floor\s+(.+)$/i, (match) => `Piso ${match[1]}`],
  [/^Last\s+(\d+)\s+days$/i, (match) => `Ultimos ${match[1]} dias`],
  [/^(\d+)%\s+occ$/i, (match) => `${match[1]}% ocup.`],
  [/^(\d+)m\s+clean$/i, (match) => `${match[1]}m limpieza`],
  [/^(\d+)\s+WOs$/i, (match) => `${match[1]} ordenes`],
  [/^(\d+)\s+VIPs$/i, (match) => `${match[1]} huespedes VIP`],
  [/^(.+):\s*(.+)$/i, (match) => {
    const label = translatePhrase(match[1], PHRASE_TRANSLATIONS)
    return label === match[1] ? match[0] : `${label}: ${match[2]}`
  }],
  [/^(.+)\s+rooms$/i, (match) => `${translatePhrase(match[1], PHRASE_TRANSLATIONS).trim()} cuartos`],
]

function normalizeLanguage(language: string | null | undefined): AppLanguage {
  return language === 'es' ? 'es' : 'en'
}

function flattenDictionaryPairs(englishValue: unknown, spanishValue: unknown): Array<[string, string]> {
  if (typeof englishValue === 'string' && typeof spanishValue === 'string') {
    return [[englishValue, spanishValue]]
  }

  if (
    !englishValue ||
    !spanishValue ||
    typeof englishValue !== 'object' ||
    typeof spanishValue !== 'object'
  ) {
    return []
  }

  const englishRecord = englishValue as Record<string, unknown>
  const spanishRecord = spanishValue as Record<string, unknown>

  return Object.keys(englishRecord).flatMap((key) => flattenDictionaryPairs(englishRecord[key], spanishRecord[key]))
}

const REVERSE_TRANSLATIONS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PHRASE_TRANSLATIONS).map(([english, spanish]) => [spanish, english])),
  ...Object.fromEntries(flattenDictionaryPairs(en, es).map(([english, spanish]) => [spanish, english])),
}

function shouldSkipNode(node: Node): boolean {
  const parent = node.parentElement
  return !parent || Boolean(parent.closest(TEXT_SKIP_SELECTOR))
}

function preserveWhitespace(original: string, translated: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? ''
  const trailing = original.match(/\s*$/)?.[0] ?? ''
  return `${leading}${translated}${trailing}`
}

function translatePhrase(value: string, dictionary: Record<string, string>): string {
  const trimmed = value.trim()
  if (!trimmed) return value

  const exact = dictionary[trimmed]
  if (exact) return preserveWhitespace(value, exact)

  for (const [pattern, replacer] of REGEX_TRANSLATIONS) {
    const match = trimmed.match(pattern)
    if (match) return preserveWhitespace(value, replacer(match))
  }

  const glossary = translateWithGlossary(trimmed)
  if (glossary !== trimmed) return preserveWhitespace(value, glossary)

  return value
}

function translateWithGlossary(value: string): string {
  return GLOSSARY_TRANSLATIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function translateToEnglish(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return value
  const exact = REVERSE_TRANSLATIONS[trimmed]
  return exact ? preserveWhitespace(value, exact) : value
}

function getSourceText(current: string, stored: string | undefined, dictionary: Record<string, string>): string {
  if (!stored) return translateToEnglish(current)

  const storedSpanish = translatePhrase(stored, dictionary)
  const currentAsEnglish = translateToEnglish(current)

  if (current === stored || current === storedSpanish || currentAsEnglish === stored) return stored

  return currentAsEnglish
}

function hasTranslation(value: string, dictionary: Record<string, string>): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (dictionary[trimmed]) return true
  if (REGEX_TRANSLATIONS.some(([pattern]) => pattern.test(trimmed))) return true
  return translateWithGlossary(trimmed) !== trimmed
}

function translateTextNode(node: Text, language: AppLanguage) {
  if (shouldSkipNode(node)) return

  const current = node.nodeValue ?? ''
  const original = getSourceText(current, textOriginals.get(node), PHRASE_TRANSLATIONS)
  textOriginals.set(node, original)

  if (language === 'es' && !hasTranslation(original, PHRASE_TRANSLATIONS)) return

  const nextValue = language === 'es' ? translatePhrase(original, PHRASE_TRANSLATIONS) : translateToEnglish(original)
  if (current !== nextValue) node.nodeValue = nextValue
}

function translateAttributes(element: Element, language: AppLanguage) {
  if (element.closest(ATTRIBUTE_SKIP_SELECTOR)) return

  let originals = attrOriginals.get(element)

  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attribute)
    if (!current) continue

    if (!originals) {
      originals = new Map()
      attrOriginals.set(element, originals)
    }

    const original = getSourceText(current, originals.get(attribute), ATTRIBUTE_TRANSLATIONS)
    originals.set(attribute, original)

    if (language === 'es' && !hasTranslation(original, ATTRIBUTE_TRANSLATIONS)) continue

    const nextValue = language === 'es' ? translatePhrase(original, ATTRIBUTE_TRANSLATIONS) : translateToEnglish(original)
    if (element.getAttribute(attribute) !== nextValue) element.setAttribute(attribute, nextValue)
  }
}

export function translateDom(root: ParentNode, languageInput: string | null | undefined) {
  const language = normalizeLanguage(languageInput)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)

  let node: Node | null = walker.currentNode
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      translateTextNode(node as Text, language)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      translateAttributes(node as Element, language)
    }

    node = walker.nextNode()
  }
}

export function installDomTranslator(languageInput: string | null | undefined) {
  translateDom(document.body, languageInput)

  const observer = new MutationObserver((mutations) => {
    const language = normalizeLanguage(languageInput)
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        translateTextNode(mutation.target as Text, language)
      }

      if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
        translateAttributes(mutation.target as Element, language)
      }

      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text, language)
        if (node.nodeType === Node.ELEMENT_NODE) translateDom(node as Element, language)
      })
    }
  })

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    characterData: true,
    childList: true,
    subtree: true,
  })

  return () => observer.disconnect()
}
