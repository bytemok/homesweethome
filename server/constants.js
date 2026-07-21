'use strict';
// Estados de fabricación (orden canónico) -----------------------------------
const STATES = [
  'nuevo', 'visto', 'confirmado', 'en_produccion', 'pendiente_materiales',
  'en_tapiceria', 'en_terminacion', 'terminado', 'embalado', 'listo_retiro',
  'despachado', 'recibido_parcial', 'recibido_completo', 'demorado',
  'con_problema', 'cancelado',
];

const STATE_LABELS = {
  nuevo: 'Nuevo',
  visto: 'Visto por el proveedor',
  confirmado: 'Confirmado',
  en_produccion: 'En producción',
  pendiente_materiales: 'Pendiente de materiales',
  en_tapiceria: 'En tapicería',
  en_terminacion: 'En terminación',
  terminado: 'Terminado',
  embalado: 'Embalado',
  listo_retiro: 'Listo para retirar',
  despachado: 'Despachado',
  recibido_parcial: 'Recibido parcialmente',
  recibido_completo: 'Recibido completamente',
  demorado: 'Demorado',
  con_problema: 'Con problema',
  cancelado: 'Cancelado',
};

const CONFIRMATION_LABELS = {
  nuevo: 'Nuevo',
  recibido: 'Pedido recibido',
  confirmado: 'Pedido confirmado',
  aclaracion: 'Necesito una aclaración',
  no_puedo: 'No puedo realizarlo',
  rechazado: 'Pedido rechazado',
};

// Resultados posibles de recepción en depósito ------------------------------
const RECEPTION_RESULTS = {
  recibido: 'Recibido correctamente',
  parcial: 'Recibido parcialmente',
  producto_equivocado: 'Producto equivocado',
  tela_incorrecta: 'Tela incorrecta',
  color_incorrecto: 'Color incorrecto',
  patas_incorrectas: 'Patas incorrectas',
  faltan_adicionales: 'Faltan adicionales',
  danado: 'Producto dañado',
  falta_bulto: 'Falta un bulto',
  pendiente_revision: 'Pendiente de revisión',
};

module.exports = { STATES, STATE_LABELS, CONFIRMATION_LABELS, RECEPTION_RESULTS };
