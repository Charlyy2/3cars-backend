const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

// POST /auth/register - Registrar usuario
router.post('/register', authController.register);

// POST /auth/login - Iniciar sesión
router.post('/login', authController.login);

// POST /auth/change-password - Cambiar contraseña
router.post('/change-password', authenticateToken, authController.changePassword);

module.exports = router;
