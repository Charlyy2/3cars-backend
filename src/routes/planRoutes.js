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
router.post('/:id/entrega-capital', planController.registrarEntregaCapital);
router.post('/:id/resolver', planController.resolverPlan);
router.post('/:id/iniciar-saldo', planController.iniciarSaldo);

module.exports = router;
