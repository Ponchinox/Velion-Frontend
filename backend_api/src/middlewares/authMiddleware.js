import jwt from 'jsonwebtoken';

/**
 * Middleware para validar el token JWT e inyectar el contexto de usuario/tenant en la petición
 */
export default function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecreto123');
    req.user = decoded; // Inyecta { userId, email, role, tenantId }

    // Permitir que un SuperAdmin impersone a otro Tenant enviando la cabecera X-Tenant-Id
    const impersonatedTenantId = req.headers['x-tenant-id'];
    if (impersonatedTenantId && req.user.role === 'superadmin') {
      req.user.tenantId = impersonatedTenantId;
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}
