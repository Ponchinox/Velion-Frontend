import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  CheckCircle,
  CaretRight,
  ArrowRight,
  Lock,
  CirclesThreePlus,
  WebhooksLogo,
  ShoppingBagOpen,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import * as integrationService from '../services/integrationService';
import shopifyLogo from '../assets/integrations/shopify.svg';

export default function IntegrationsPage() {
  const navigate = useNavigate();
  const [shopifyLoading, setShopifyLoading] = useState(true);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState('');

  useEffect(() => {
    async function loadShopifyState() {
      try {
        setShopifyLoading(true);
        const res = await integrationService.getShopifyStatus();
        if (res && res.status === 'CONNECTED') {
          setShopifyConnected(true);
          setShopifyDomain(res.shopDomain || '');
        } else {
          setShopifyConnected(false);
        }
      } catch (err) {
        console.error('[Integraciones Hub] Error cargando estado:', err.message);
        setShopifyConnected(false);
      } finally {
        setShopifyLoading(false);
      }
    }
    loadShopifyState();
  }, []);

  return (
    <div className="w-full flex flex-col space-y-6 animate-in fade-in duration-200">
      {/* ─── Breadcrumb ──────────────────────────────────────────────────────── */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-lo">
        <Link to="/settings" className="hover:text-hi transition-colors font-medium">
          Ajustes
        </Link>
        <CaretRight size={12} className="text-muted" />
        <span className="text-hi font-semibold">Integraciones</span>
      </nav>

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-hi">Integraciones</h1>
        <p className="text-xs text-lo mt-1">
          Conecta tus plataformas de comercio y servicios externos para sincronizar catálogos y pedidos.
        </p>
      </div>

      {/* ─── Bento Grid Hub ─────────────────────────────────────────────────── */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {/* ── 1. SHOPIFY (ACTIVA Y FUNCIONAL) ── */}
        <div
          onClick={() => navigate('/integraciones/shopify')}
          className="group relative flex flex-col justify-between p-6 bg-card border border-line rounded-2xl shadow-sm hover:border-brand/50 hover:shadow-md transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50/70 border border-emerald-100 p-2.5 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <img src={shopifyLogo} alt="Shopify" className="w-full h-full object-contain" />
              </div>
              {shopifyLoading ? (
                <span className="px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-slate-100 text-slate-500">
                  Cargando...
                </span>
              ) : shopifyConnected ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <CheckCircle size={13} weight="fill" />
                  Conectado
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  No conectado
                </span>
              )}
            </div>

            <h3 className="text-base font-bold text-hi mb-1 group-hover:text-brand transition-colors">
              Shopify
            </h3>
            <p className="text-xs text-lo leading-relaxed mb-4">
              Conecta tu tienda y sincroniza productos, precios e inventario en tiempo real con el agente de IA.
            </p>

            {shopifyConnected && shopifyDomain && (
              <div className="mb-4 p-2.5 rounded-xl bg-app border border-line text-2xs font-mono font-medium text-hi truncate">
                {shopifyDomain}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-line flex items-center justify-between">
            <span className="text-xs font-semibold text-brand flex items-center gap-1.5 group-hover:translate-x-0.5 transition-transform">
              {shopifyConnected ? 'Configurar integración' : 'Conectar tienda'}
              <ArrowRight size={14} weight="bold" />
            </span>
          </div>
        </div>

        {/* ── 2. WOOCOMMERCE (PRÓXIMAMENTE) ── */}
        <div className="relative flex flex-col justify-between p-6 bg-app/50 border border-line/70 rounded-2xl opacity-75 cursor-not-allowed">
          <div>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 border border-purple-100 p-3 flex items-center justify-center text-purple-600 shrink-0">
                <ShoppingBagOpen size={28} weight="duotone" />
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider bg-slate-200/70 text-slate-600">
                Próximamente
              </span>
            </div>

            <h3 className="text-base font-bold text-hi mb-1">WooCommerce</h3>
            <p className="text-xs text-lo leading-relaxed">
              Sincroniza catálogo de productos, variaciones, stock y pedidos desde tu tienda WordPress.
            </p>
          </div>

          <div className="pt-4 mt-6 border-t border-line/60 flex items-center justify-between text-2xs text-muted font-medium">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> Integración en desarrollo
            </span>
          </div>
        </div>

        {/* ── 3. TIENDANUBE (PRÓXIMAMENTE) ── */}
        <div className="relative flex flex-col justify-between p-6 bg-app/50 border border-line/70 rounded-2xl opacity-75 cursor-not-allowed">
          <div>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 p-3 flex items-center justify-center text-blue-600 shrink-0">
                <CirclesThreePlus size={28} weight="duotone" />
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider bg-slate-200/70 text-slate-600">
                Próximamente
              </span>
            </div>

            <h3 className="text-base font-bold text-hi mb-1">Tiendanube</h3>
            <p className="text-xs text-lo leading-relaxed">
              Conecta tu ecommerce de Tiendanube para automatizar la atención comercial de clientes.
            </p>
          </div>

          <div className="pt-4 mt-6 border-t border-line/60 flex items-center justify-between text-2xs text-muted font-medium">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> Integración en desarrollo
            </span>
          </div>
        </div>

        {/* ── 4. MERCADO LIBRE (PRÓXIMAMENTE) ── */}
        <div className="relative flex flex-col justify-between p-6 bg-app/50 border border-line/70 rounded-2xl opacity-75 cursor-not-allowed">
          <div>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-yellow-50 border border-yellow-100 p-3 flex items-center justify-center text-yellow-600 shrink-0">
                <ShoppingBagOpen size={28} weight="duotone" />
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider bg-slate-200/70 text-slate-600">
                Próximamente
              </span>
            </div>

            <h3 className="text-base font-bold text-hi mb-1">Mercado Libre</h3>
            <p className="text-xs text-lo leading-relaxed">
              Atiende preguntas de publicaciones y sincroniza tus ventas y pedidos de Mercado Libre.
            </p>
          </div>

          <div className="pt-4 mt-6 border-t border-line/60 flex items-center justify-between text-2xs text-muted font-medium">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> Integración en desarrollo
            </span>
          </div>
        </div>

        {/* ── 5. API / WEBHOOKS (PRÓXIMAMENTE) ── */}
        <div className="relative flex flex-col justify-between p-6 bg-app/50 border border-line/70 rounded-2xl opacity-75 cursor-not-allowed">
          <div>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 p-3 flex items-center justify-center text-slate-700 shrink-0">
                <WebhooksLogo size={28} weight="duotone" />
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider bg-slate-200/70 text-slate-600">
                Próximamente
              </span>
            </div>

            <h3 className="text-base font-bold text-hi mb-1">API / Webhooks</h3>
            <p className="text-xs text-lo leading-relaxed">
              Envía y recibe eventos personalizados en tiempo real para conectar tu CRM, ERP o sistema propio.
            </p>
          </div>

          <div className="pt-4 mt-6 border-t border-line/60 flex items-center justify-between text-2xs text-muted font-medium">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> Integración en desarrollo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
