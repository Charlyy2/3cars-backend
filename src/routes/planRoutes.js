const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');

router.post('/', planController.createPlan);
router.get('/caidos/lista', planController.getFallenPlans);
router.post('/verificar-mora', planController.checkAndCancelOverduePlans);
router.get('/saldo', planController.getSaldo);           // estática: antes de /:id
router.get('/', planController.getPlanByClientId);
router.get('/:id', planController.getPlanById);
router.post('/:id/retirar', planController.retirarVehiculo);
router.post('/:id/cancelar', planController.cancelPlan);
router.post('/:id/negociacion', planController.marcarNegociacion);
router.post('/:id/seguir-pagando', planController.habilitarPagoAbierto);
router.post('/:id/entrega-capital', planController.registrarEntregaCapital);
router.post('/:id/resolver', planController.resolverPlan);
router.post('/:id/iniciar-saldo', planController.iniciarSaldo);
// Objetivo del plan: regularización (ajustes/condonaciones) e historial
router.get('/:id/objetivo', planController.getObjetivo);
router.get('/:id/ajustes-objetivo', planController.listarAjustes);
router.post('/:id/ajustes-objetivo', planController.crearAjuste);
router.post('/:id/ajustes-objetivo/:ajusteId/anular', planController.anularAjuste);
// Modificar valor de cuota (importe base de las cuotas abiertas; no mueve Caja)
router.get('/:id/modificar-cuotas/preview', planController.previewModificacionCuotas);
router.post('/:id/modificar-cuotas', planController.modificarCuotas);
// Reactivar un plan CAÍDO (acción explícita; requiere < 3 cuotas vencidas impagas)
router.get('/:id/reactivar/preview', planController.previewReactivacion);
router.post('/:id/reactivar', planController.reactivarPlan);
router.get('/:id/historial', planController.getHistorial);

module.exports = router;
