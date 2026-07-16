/**
 * Middleware para asegurar que el usuario tenga el rol de 'superadmin'
 */
export default function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren privilegios de SuperAdmin.' });
  }
  next();
}
