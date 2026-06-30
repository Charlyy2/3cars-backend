/**
 * Catálogo de categorías de caja (única fuente de verdad de nombres y metadata).
 *
 * Campos:
 *  - name: key interna (no renombrar sin migración de datos)
 *  - label: nombre amigable para la UI
 *  - type: INGRESO | EGRESO (define el tipo del movimiento)
 *  - system: no se puede eliminar
 *  - isManual: si puede crearse desde el alta manual de Caja
 *  - requiresClient: si el alta manual exige un cliente (se crea desde el detalle del cliente)
 *
 * Las categorías AUTOMÁTICAS (isManual:false) las genera el sistema (pagos, resolución
 * de plan) y NUNCA pueden crearse a mano.
 */
const CASH_CATEGORIES = [
  // ===== INGRESOS =====
  // Automáticos
  { name: 'COBRO_CUOTA',          label: 'Cobro de cuota',          type: 'INGRESO', system: true, isManual: false, requiresClient: false },
  { name: 'ENTREGA_CAPITAL',      label: 'Entrega de capital',      type: 'INGRESO', system: true, isManual: false, requiresClient: false },
  { name: 'GASTO_RETIRO_COBRADO', label: 'Gasto de retiro cobrado', type: 'INGRESO', system: true, isManual: false, requiresClient: false },
  { name: 'SELLADO',              label: 'Sellado',                 type: 'INGRESO', system: true, isManual: false, requiresClient: false },
  // Manual
  { name: 'OTROS',                label: 'Otros ingresos',          type: 'INGRESO', system: true, isManual: true,  requiresClient: false },

  // ===== EGRESOS =====
  // Automáticos
  { name: 'COMISION_CUOTA',       label: 'Comisión por cuota',       type: 'EGRESO', system: true, isManual: false, requiresClient: false },
  { name: 'COMISION_NEGOCIACION', label: 'Comisión de negociación',  type: 'EGRESO', system: true, isManual: false, requiresClient: false },
  { name: 'GASTO_RETIRO_REAL',    label: 'Gasto de retiro real',     type: 'EGRESO', system: true, isManual: false, requiresClient: false },
  { name: 'DEVOLUCION',           label: 'Devolución',               type: 'EGRESO', system: true, isManual: false, requiresClient: false },
  // Manuales (gastos operativos de la empresa, sin cliente)
  { name: 'COMBUSTIBLE',          label: 'Combustible',              type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'HOSPEDAJE',            label: 'Hospedaje',                type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'PEAJE',                label: 'Peaje',                    type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'VIATICOS',             label: 'Viáticos',                 type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'LIBRERIA',             label: 'Librería',                 type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'ESTUDIO_JURIDICO',     label: 'Estudio jurídico',         type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'ESTUDIO_CONTABLE',     label: 'Estudio contable',         type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'ALQUILER',             label: 'Alquiler',                 type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'SERVICIOS',            label: 'Servicios',                type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'IMPUESTOS',            label: 'Impuestos',                type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'ADQUISICION_VEHICULO', label: 'Adquisición de vehículo',  type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'SUELDOS',              label: 'Sueldos',                  type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  { name: 'GASTOS_VARIOS',        label: 'Gastos varios',            type: 'EGRESO', system: true, isManual: true, requiresClient: false },
  // Manuales que requieren cliente (se crean desde el detalle del cliente)
  { name: 'GASTOS_ADMINISTRATIVOS', label: 'Gastos administrativos', type: 'EGRESO', system: true, isManual: true, requiresClient: true },
  { name: 'GARANTIAS',            label: 'Garantías',                type: 'EGRESO', system: true, isManual: true, requiresClient: true },
];

// Keys usadas por la generación automática.
const CAT = {
  COBRO_CUOTA: 'COBRO_CUOTA',
  ENTREGA_CAPITAL: 'ENTREGA_CAPITAL',
  GASTO_RETIRO_COBRADO: 'GASTO_RETIRO_COBRADO',
  GASTO_RETIRO_REAL: 'GASTO_RETIRO_REAL',
  SELLADO: 'SELLADO',
  COMISION_CUOTA: 'COMISION_CUOTA',
  COMISION_NEGOCIACION: 'COMISION_NEGOCIACION',
  DEVOLUCION: 'DEVOLUCION',
};

// Mapa key -> label (para exponer nombres amigables si hiciera falta en backend).
const CATEGORY_LABELS = CASH_CATEGORIES.reduce((acc, c) => {
  acc[c.name] = c.label;
  return acc;
}, {});

module.exports = { CASH_CATEGORIES, CAT, CATEGORY_LABELS };
