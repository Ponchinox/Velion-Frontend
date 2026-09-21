import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, CaretRight } from '@phosphor-icons/react';
import { NAVIGATION_CONFIG, normalizeNavRoute } from '../../config/navigationConfig';

/**
 * Encabezado global unificado de navegación interna y breadcrumbs para Velion.
 * 
 * Estructura visual de dos filas:
 * Fila 1: ← Volver a <página padre> (botón discreto, texto azul, sin caja grande)
 * Fila 2: Breadcrumb navegable (links azules, chevron separador, texto oscuro para página actual)
 * 
 * @param {Object} props
 * @param {string} [props.backTo] - Ruta URL a la que retorna el botón de regreso (ej: '/settings')
 * @param {string} [props.backLabel] - Texto del botón de regreso (ej: 'Volver a Ajustes')
 * @param {Array<{label: string, to?: string, onClick?: () => void}>} [props.breadcrumbs] - Lista de migas de pan
 * @param {Function} [props.onBack] - Callback de retorno para páginas con estado interno (ej: SettingsPage)
 * @param {string} [props.className] - Clases CSS adicionales para el contenedor
 */
export default function PageNavigationHeader({
  backTo,
  backLabel,
  breadcrumbs,
  onBack,
  className = '',
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Resolución por configuración centralizada si no se proveen props explícitas
  const normalizedPath = location.pathname.replace(/\/$/, '') || '/';
  const config = NAVIGATION_CONFIG[normalizedPath] || NAVIGATION_CONFIG[location.pathname] || {};
  const effectiveBackTo = normalizeNavRoute(backTo || config.backTo || '/settings');
  const effectiveBackLabel = backLabel || config.backLabel || 'Volver';
  const effectiveBreadcrumbs = breadcrumbs || config.breadcrumbs || [];

  const handleBackClick = (e) => {
    if (onBack) {
      e.preventDefault();
      onBack();
    } else if (effectiveBackTo) {
      navigate(effectiveBackTo);
    }
  };

  return (
    <div className={`w-full flex flex-col gap-1.5 ${className}`}>
      {/* ─── Fila 1: Volver a <página padre> ─────────────────────────────────── */}
      <div className="flex items-center">
        {onBack ? (
          <button
            type="button"
            onClick={handleBackClick}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-all cursor-pointer self-start group py-0.5"
          >
            <ArrowLeft
              size={13}
              weight="bold"
              className="transition-transform duration-150 group-hover:-translate-x-0.5"
            />
            <span>{effectiveBackLabel}</span>
          </button>
        ) : (
          <Link
            to={effectiveBackTo}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-all cursor-pointer self-start group py-0.5"
          >
            <ArrowLeft
              size={13}
              weight="bold"
              className="transition-transform duration-150 group-hover:-translate-x-0.5"
            />
            <span>{effectiveBackLabel}</span>
          </Link>
        )}
      </div>

      {/* ─── Fila 2: Breadcrumb navegable ───────────────────────────────────── */}
      {effectiveBreadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1.5 text-xs text-lo"
        >
          {effectiveBreadcrumbs.map((crumb, idx) => {
            const isLast = idx === effectiveBreadcrumbs.length - 1;
            const normalizedTo = crumb.to ? normalizeNavRoute(crumb.to) : null;

            return (
              <React.Fragment key={idx}>
                {idx > 0 && (
                  <CaretRight size={11} className="text-muted shrink-0" />
                )}
                {isLast || (!normalizedTo && !crumb.onClick) ? (
                  <span className="text-hi font-semibold truncate">
                    {crumb.label}
                  </span>
                ) : normalizedTo ? (
                  <Link
                    to={normalizedTo}
                    className="text-blue-600 hover:text-blue-700 hover:underline font-medium transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={crumb.onClick}
                    className="text-blue-600 hover:text-blue-700 hover:underline font-medium transition-colors cursor-pointer"
                  >
                    {crumb.label}
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      )}
    </div>
  );
}
