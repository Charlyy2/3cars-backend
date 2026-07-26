const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET no está definido en las variables de entorno.');
  process.exit(1);
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.user = user;
    next();
  });
};

// Rol de solo lectura: puede ver todo pero no modificar nada.
const READONLY_ROLE = 'VIEWER';

// Bloquea cualquier método que no sea GET para usuarios VIEWER.
// Se aplica DESPUÉS de authenticateToken (necesita req.user).
// Devuelve un `code` propio para que el front lo distinga del 403 de token inválido.
const blockViewerWrites = (req, res, next) => {
  if (req.user && req.user.role === READONLY_ROLE && req.method !== 'GET') {
    return res.status(403).json({
      error: 'Tu usuario es de solo lectura y no puede realizar esta acción',
      code: 'READ_ONLY',
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  blockViewerWrites,
  READONLY_ROLE,
};
