import bcrypt from 'bcryptjs';
import prisma from '../db.js';

/**
 * GET /api/users/me
 * Recupera el perfil del usuario autenticado actual
 */
export async function getProfile(req, res) {
  try {
    const { userId } = req.user;
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name || '',
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        tenantId: user.tenantId
      }
    });
  } catch (error) {
    console.error('Error al obtener perfil del usuario:', error);
    return res.status(500).json({ error: 'Error interno al obtener el perfil.' });
  }
}

/**
 * PUT /api/users/profile
 * Actualiza el nombre, correo y opcionalmente el teléfono del usuario autenticado
 */
export async function updateProfile(req, res) {
  try {
    const { userId } = req.user;
    const { name, email, phone } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'El correo electrónico es un campo requerido.' });
    }

    // Verificar si el nuevo correo está ocupado por otro usuario
    const userWithEmail = await prisma.user.findUnique({
      where: { email }
    });

    if (userWithEmail && userWithEmail.id !== userId) {
      return res.status(400).json({ error: 'El correo electrónico ya está en uso por otra cuenta.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name || null,
        email,
        phone: phone || null
      }
    });

    return res.json({
      message: 'Perfil de administrador actualizado con éxito.',
      user: {
        id: updatedUser.id,
        name: updatedUser.name || '',
        email: updatedUser.email,
        phone: updatedUser.phone || '',
        role: updatedUser.role,
        tenantId: updatedUser.tenantId
      }
    });
  } catch (error) {
    console.error('Error al actualizar el perfil del usuario:', error);
    return res.status(500).json({ error: 'Error interno al actualizar el perfil.' });
  }
}

/**
 * PUT /api/users/password
 * Modifica la contraseña del usuario tras verificar la contraseña actual
 */
export async function updatePassword(req, res) {
  try {
    const { userId } = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Debes proporcionar la contraseña actual y la nueva contraseña.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    // Verificar contraseña actual
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'La contraseña actual ingresada es incorrecta.' });
    }

    // Encriptar la nueva contraseña
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedNewPassword
      }
    });

    return res.json({ message: 'Contraseña actualizada con éxito.' });
  } catch (error) {
    console.error('Error al actualizar la contraseña del usuario:', error);
    return res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
  }
}
