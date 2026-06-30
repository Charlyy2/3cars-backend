const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET no está definido en las variables de entorno.');
  process.exit(1);
}
const JWT_EXPIRES_IN = '24h';

const register = async (username, password, email) => {
  // Verificar si el usuario ya existe
  const existingUser = await prisma.user.findUnique({
    where: { username }
  });

  if (existingUser) {
    throw new Error('USERNAME_EXISTS');
  }

  if (email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email }
    });

    if (existingEmail) {
      throw new Error('EMAIL_EXISTS');
    }
  }

  // Hashear contraseña
  const hashedPassword = await bcrypt.hash(password, 10);

  // Crear usuario
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: hashedPassword,
      email,
      role: 'USER',
      active: true
    }
  });

  // Generar token
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt
    },
    token
  };
};

const login = async (identifier, password) => {
  // Buscar usuario por email o username
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { username: identifier }
      ]
    }
  });

  if (!user) {
    throw new Error('INVALID_CREDENTIALS');
  }

  // Verificar si el usuario está activo
  if (!user.active) {
    throw new Error('USER_INACTIVE');
  }

  // Verificar contraseña
  const validPassword = await bcrypt.compare(password, user.passwordHash);

  if (!validPassword) {
    throw new Error('INVALID_CREDENTIALS');
  }

  // Generar token
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt
    },
    token
  };
};

const changePassword = async (userId, currentPassword, newPassword) => {
  // Buscar usuario
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  // Verificar contraseña actual
  const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!validPassword) {
    throw new Error('INVALID_CURRENT_PASSWORD');
  }

  // Hashear nueva contraseña
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Actualizar contraseña
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashedPassword }
  });

  return { success: true };
};

module.exports = {
  register,
  login,
  changePassword
};
