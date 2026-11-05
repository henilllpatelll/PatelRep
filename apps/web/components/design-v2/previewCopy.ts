/** SAMPLE DATA + copy for the Design V2 manager reference preview. Never read from or written to
 *  any backend, and always shown under a "sample data" banner. The preview carries its own tiny
 *  en/es dictionary (manager screens are English per D-03) so Spanish-length text wrapping can be
 *  checked without touching the app i18n bundles. */
export type Lang = 'en' | 'es'

export type StatusKey = 'ready' | 'clean' | 'inProgress' | 'dirty' | 'occupied' | 'pickup' | 'outOfOrder'

export const copy = {
  en: {
    banner: 'Design V2 preview · sample data',
    bannerBody: 'Every figure, name and “AI” suggestion on this page is invented sample data. Nothing is read from or saved to PatelRep.',
    theme: 'Theme', light: 'Light', dark: 'Dark', language: 'Language', states: 'States',
    brand: 'PatelRep', openMenu: 'Open navigation', closeMenu: 'Close navigation', closeDrawer: 'Close details',
    nav: { dashboard: 'Dashboard', housekeeping: 'Housekeeping', engineering: 'Engineering', tasks: 'Tasks', scheduling: 'Scheduling', reports: 'Reports', staff: 'Staff', settings: 'Settings' },
    property: 'Property', propertyName: 'Sample Hotel (demo)', search: 'Search rooms, tasks, people', searchShort: 'Search', notifications: 'Notifications', account: 'Account menu',
    accountRole: 'General manager',
    welcome: 'Good morning, Alex', date: 'Tuesday · sample data',
    kpiOccupancy: 'Occupancy', kpiReady: 'Rooms ready', kpiOpenWo: 'Open work orders', kpiStaff: 'Staff on duty', kpiRequests: 'Guest requests',
    kpiOccupancyCap: '41 of 50 rooms', kpiReadyCap: 'for 3 PM check-in', kpiOpenWoCap: '2 overdue', kpiStaffCap: '14 of 16 scheduled', kpiRequestsCap: '1 waiting over 15 min',
    readiness: 'Room readiness', readinessHint: '50 rooms · sample', total: 'rooms',
    status: { ready: 'Ready', clean: 'Clean', inProgress: 'In progress', dirty: 'Dirty', occupied: 'Occupied', pickup: 'Pickup', outOfOrder: 'Out of order' } as Record<StatusKey, string>,
    exceptions: 'Priority exceptions', exceptionsHint: 'Needs a decision today', viewAll: 'View all',
    critical: 'Critical', attention: 'Attention', info: 'Info',
    ex1: 'Room 218: guest waiting over 15 min', ex1m: 'Guest request · Front desk',
    ex2: 'HVAC leak in Room 305 is overdue', ex2m: 'Work order WO-1042 · due 9:00 AM',
    ex3: '3 early check-ins not ready', ex3m: 'Rooms 112, 114, 220 · arrive by 1 PM',
    ex4: 'Inspection failed in Room 407', ex4m: 'Bathroom fan · re-clean needed',
    drawerTitle: 'Exception details', drawerBody: 'Sample details for this item. In the real product this drawer shows the record, its history and the next action.', drawerAction: 'Assign someone', drawerSecondary: 'Add a note',
    team: 'Team pulse', teamHint: 'Staffing against plan',
    teamHk: 'Housekeeping', teamEng: 'Engineering', teamFd: 'Front desk',
    onDuty: '{n} of {t} on duty', avgClean: 'Average clean time', avgCleanValue: '28 min', avgCleanDelta: '2 min faster than last week',
    workOrders: 'Work orders', workOrdersHint: 'Newest first · sample',
    colId: 'ID', colIssue: 'Issue', colLocation: 'Location', colPriority: 'Priority', colAssignee: 'Assigned to', colDue: 'Due',
    woRows: [
      { id: 'WO-1042', issue: 'Ceiling leak above bed', location: 'Room 305', priority: 'critical', assignee: 'Dev P.', due: '9:00 AM' },
      { id: 'WO-1047', issue: 'TV will not power on', location: 'Room 118', priority: 'attention', assignee: 'Unassigned', due: '1:00 PM' },
      { id: 'WO-1051', issue: 'Ice machine not cooling', location: '2nd floor', priority: 'attention', assignee: 'Sam R.', due: 'Today' },
      { id: 'WO-1053', issue: 'Replace hallway bulb', location: 'Building B', priority: 'info', assignee: 'Dev P.', due: 'Friday' },
    ],
    ai: 'AI insights', aiLabel: 'AI', aiProvenance: 'Sample text. Not generated from real data or a real forecast.',
    ai1: 'Sample insight: Rooms 112, 114 and 220 could be cleaned first to protect the early check-ins.',
    ai2: 'Sample insight: Two checkouts are running long. Consider moving one housekeeper from floor 1 to floor 2.',
    ai3: 'Sample insight: HVAC work orders cluster in Building B this week.',
    statesTitle: 'Component states', statesHint: 'Reference for the shared loading, empty, error and offline patterns.',
    stLoading: 'Loading', stEmpty: 'Nothing to show', stEmptyBody: 'No work orders match these filters.', stError: 'Could not load rooms', stErrorBody: 'Check your connection and try again.', stOffline: 'You are offline', stOfflineBody: 'Showing the last saved data.', retry: 'Try again', clear: 'Clear filters',
    buttons: 'Buttons', primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary', destructive: 'Destructive', disabled: 'Disabled',
    fields: 'Fields', fieldLabel: 'Room number', fieldHelp: 'Four digits, for example 0412.', fieldError: 'Enter a room that exists.', segmented: 'View',
    segA: 'Today', segB: 'Week', segC: 'Month',
  },
  es: {
    banner: 'Vista previa de Diseño V2 · datos de muestra',
    bannerBody: 'Todas las cifras, nombres y sugerencias de “IA” de esta página son datos de muestra inventados. Nada se lee ni se guarda en PatelRep.',
    theme: 'Tema', light: 'Claro', dark: 'Oscuro', language: 'Idioma', states: 'Estados',
    brand: 'PatelRep', openMenu: 'Abrir navegación', closeMenu: 'Cerrar navegación', closeDrawer: 'Cerrar detalles',
    nav: { dashboard: 'Panel', housekeeping: 'Ama de llaves', engineering: 'Ingeniería', tasks: 'Tareas', scheduling: 'Horarios', reports: 'Informes', staff: 'Personal', settings: 'Configuración' },
    property: 'Propiedad', propertyName: 'Hotel de muestra (demo)', search: 'Buscar habitaciones, tareas, personas', searchShort: 'Buscar', notifications: 'Notificaciones', account: 'Menú de cuenta',
    accountRole: 'Gerente general',
    welcome: 'Buenos días, Alex', date: 'Martes · datos de muestra',
    kpiOccupancy: 'Ocupación', kpiReady: 'Habitaciones listas', kpiOpenWo: 'Órdenes de trabajo abiertas', kpiStaff: 'Personal en turno', kpiRequests: 'Solicitudes de huéspedes',
    kpiOccupancyCap: '41 de 50 habitaciones', kpiReadyCap: 'para la entrada de las 3 PM', kpiOpenWoCap: '2 vencidas', kpiStaffCap: '14 de 16 programados', kpiRequestsCap: '1 esperando más de 15 min',
    readiness: 'Disponibilidad de habitaciones', readinessHint: '50 habitaciones · muestra', total: 'habitaciones',
    status: { ready: 'Lista', clean: 'Limpia', inProgress: 'En curso', dirty: 'Sucia', occupied: 'Ocupada', pickup: 'Repaso', outOfOrder: 'Fuera de servicio' } as Record<StatusKey, string>,
    exceptions: 'Excepciones prioritarias', exceptionsHint: 'Requiere una decisión hoy', viewAll: 'Ver todo',
    critical: 'Crítico', attention: 'Atención', info: 'Info',
    ex1: 'Habitación 218: huésped esperando más de 15 min', ex1m: 'Solicitud de huésped · Recepción',
    ex2: 'La fuga de aire acondicionado en la 305 está vencida', ex2m: 'Orden WO-1042 · vence 9:00 AM',
    ex3: '3 entradas tempranas sin habitación lista', ex3m: 'Habitaciones 112, 114, 220 · llegan antes de la 1 PM',
    ex4: 'Inspección fallida en la habitación 407', ex4m: 'Extractor del baño · falta limpiar de nuevo',
    drawerTitle: 'Detalles de la excepción', drawerBody: 'Detalles de muestra de este elemento. En el producto real este panel muestra el registro, su historial y la siguiente acción.', drawerAction: 'Asignar a alguien', drawerSecondary: 'Agregar una nota',
    team: 'Pulso del equipo', teamHint: 'Personal frente al plan',
    teamHk: 'Ama de llaves', teamEng: 'Ingeniería', teamFd: 'Recepción',
    onDuty: '{n} de {t} en turno', avgClean: 'Tiempo promedio de limpieza', avgCleanValue: '28 min', avgCleanDelta: '2 min más rápido que la semana pasada',
    workOrders: 'Órdenes de trabajo', workOrdersHint: 'Más recientes primero · muestra',
    colId: 'ID', colIssue: 'Problema', colLocation: 'Ubicación', colPriority: 'Prioridad', colAssignee: 'Asignada a', colDue: 'Vence',
    woRows: [
      { id: 'WO-1042', issue: 'Goteo en el techo sobre la cama', location: 'Habitación 305', priority: 'critical', assignee: 'Dev P.', due: '9:00 AM' },
      { id: 'WO-1047', issue: 'La televisión no enciende', location: 'Habitación 118', priority: 'attention', assignee: 'Sin asignar', due: '1:00 PM' },
      { id: 'WO-1051', issue: 'La máquina de hielo no enfría', location: 'Segundo piso', priority: 'attention', assignee: 'Sam R.', due: 'Hoy' },
      { id: 'WO-1053', issue: 'Cambiar foco del pasillo', location: 'Edificio B', priority: 'info', assignee: 'Dev P.', due: 'Viernes' },
    ],
    ai: 'Perspectivas de IA', aiLabel: 'IA', aiProvenance: 'Texto de muestra. No se generó con datos reales ni un pronóstico real.',
    ai1: 'Ejemplo: se podrían limpiar primero las habitaciones 112, 114 y 220 para proteger las entradas tempranas.',
    ai2: 'Ejemplo: dos salidas van lentas. Considere mover a una camarera del piso 1 al piso 2.',
    ai3: 'Ejemplo: las órdenes de aire acondicionado se concentran en el Edificio B esta semana.',
    statesTitle: 'Estados de componentes', statesHint: 'Referencia de los patrones compartidos de carga, vacío, error y sin conexión.',
    stLoading: 'Cargando', stEmpty: 'Nada que mostrar', stEmptyBody: 'Ninguna orden de trabajo coincide con estos filtros.', stError: 'No se pudieron cargar las habitaciones', stErrorBody: 'Revise su conexión e intente de nuevo.', stOffline: 'Sin conexión', stOfflineBody: 'Mostrando los últimos datos guardados.', retry: 'Intentar de nuevo', clear: 'Borrar filtros',
    buttons: 'Botones', primary: 'Primario', secondary: 'Secundario', tertiary: 'Terciario', destructive: 'Destructivo', disabled: 'Deshabilitado',
    fields: 'Campos', fieldLabel: 'Número de habitación', fieldHelp: 'Cuatro dígitos, por ejemplo 0412.', fieldError: 'Ingrese una habitación que exista.', segmented: 'Vista',
    segA: 'Hoy', segB: 'Semana', segC: 'Mes',
  },
} as const

/** Sample room counts for the readiness bar. Sums to 50. */
export const readinessCounts: Record<StatusKey, number> = {
  ready: 14,
  clean: 6,
  inProgress: 5,
  dirty: 9,
  occupied: 13,
  pickup: 1,
  outOfOrder: 2,
}

export const teamSample = [
  { key: 'teamHk', on: 9, total: 10 },
  { key: 'teamEng', on: 3, total: 4 },
  { key: 'teamFd', on: 2, total: 2 },
] as const

export const kpiSample = [
  { key: 'kpiOccupancy', cap: 'kpiOccupancyCap', value: '82%', icon: 'bed' },
  { key: 'kpiReady', cap: 'kpiReadyCap', value: '20', icon: 'check' },
  { key: 'kpiOpenWo', cap: 'kpiOpenWoCap', value: '9', icon: 'wrench' },
  { key: 'kpiStaff', cap: 'kpiStaffCap', value: '14', icon: 'people' },
  { key: 'kpiRequests', cap: 'kpiRequestsCap', value: '3', icon: 'bell' },
] as const
