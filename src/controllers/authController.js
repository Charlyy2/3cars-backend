const authService = require('../services/authService');

const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username y password son requeridos'
      });
    }

    const result = await authService.register(username, password, email);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error al registrar usuario:', error);

    if (error.message === 'USERNAME_EXISTS') {
      return res.status(409).json({ error: 'El usuario ya existe' });
    }

    if (error.message === 'EMAIL_EXISTS') {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    res.status(500).json({ error: 'Error al registrar usuario' });
  }
};

const login = async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;

    if (!identifier || !password) {
      return res.status(400).json({
        error: 'Email/Usuario y password son requeridos'
      });
    }

    const result = await authService.login(identifier, password);
    res.json(result);
  } catch (error) {
    console.error('Error al iniciar sesión:', error);

    if (error.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (error.message === 'USER_INACTIVE') {
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Contraseña actual y nueva son requeridas'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres'
      });
    }

    const result = await authService.changePassword(userId, currentPassword, newPassword);
    res.json(result);
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);

    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (error.message === 'INVALID_CURRENT_PASSWORD') {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
};

module.exports = {
  register,
  login,
  changePassword
};
