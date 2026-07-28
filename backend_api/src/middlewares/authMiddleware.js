import jwt from 'jsonwebtoken';
import prisma from '../db.js';

/**
 * Middleware para validar el token JWT e inyectar el contexto de usuario/tenant en la petición.
 *
 * En Modo Soporte (impersonación):
 *   - El SuperAdmin envía la cabecera X-Tenant-Id con el ID del tenant a impersonar.
 *   - El middleware sustituye tenantId Y userId por los del usuario admin del tenant impersonado.
 *   - De esta forma, todas las operaciones (productos, chats, ajustes, etc.) actúan
 *     exactamente como si el superadmin hubiera iniciado sesión con las credenciales del cliente.
 *   - El rol se mantiene en 'superadmin' para que los middlewares de permisos de plan
 *     los dejen pasar sin restricciones (ya que el soporte necesita acceso completo).
 */
export default async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET no está configurada en el entorno de Producción.');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Inyecta { userId, email, role, tenantId }

    // ── MODO SOPORTE: SuperAdmin impersonando a un Tenant ──────────────────────────
    const impersonatedTenantId = req.headers['x-tenant-id'];

    if (impersonatedTenantId && req.user.role === 'superadmin') {
      // Sobreescribir tenantId para que todos los controladores usen el del cliente
      req.user.tenantId = impersonatedTenantId;

      // Resolver el userId del administrador principal del tenant impersonado.
      // Esto es CRÍTICO para que los controladores de productos, chats, etc.
      // operen sobre los datos reales del cliente y no los del superadmin.
      try {
        const tenantAdmin = await prisma.user.findFirst({
          where: { tenantId: impersonatedTenantId, role: 'client' },
          select: { id: true },
        });

        if (tenantAdmin) {
          req.user.userId = tenantAdmin.id;
          req.user.id     = tenantAdmin.id; // compatibilidad con ambas variantes
        }
        // Si no se encuentra usuario admin (tenant vacío), se mantiene el userId del superadmin
        // y los controladores verán listas vacías pero no se crashearán.
      } catch (dbErr) {
        // No bloquear la petición por un error en la resolución; loguear y continuar.
        console.error('[authMiddleware] Error al resolver userId del tenant impersonado:', dbErr.message);
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}
