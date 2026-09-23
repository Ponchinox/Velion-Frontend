/**
 * SHOPIFY INTEGRATION CONTROLLER
 * ==============================
 * Controlador para endpoints de gestión, OAuth y estado de Shopify.
 *
 * Fronteras de autenticación:
 * - GET  /status:      Requiere authMiddleware (JWT)
 * - POST /connect:     Requiere authMiddleware (JWT)
 * - POST /disconnect:  Requiere authMiddleware (JWT)
 * - GET  /callback:    Autenticación criptográfica (HMAC + State estricto + Cookie Nonce)
 */

import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { getShopifyConfig } from '../services/integrations/shopify/shopifyConfig.js';
import { canonicalizeShopDomain } from '../services/integrations/shopify/shopifyDomain.js';
import {
  buildAuthorizationUrl,
  verifyOAuthHmac,
  verifyOAuthState,
  exchangeAuthorizationCode,
  OAUTH_COOKIE_NAME,
  getClearCookieOptions,
} from '../services/integrations/shopify/shopifyOAuthService.js';
import {
  persistConnectedTokens,
  disconnectIntegration,
} from '../services/integrations/shopify/shopifyTokenService.js';
import { syncShopifyCatalog } from '../services/integrations/shopify/shopifyCatalogSyncService.js';
import {
  ShopifyError,
  ShopifyDomainConflictError,
  ShopifyOAuthError,
  ShopifySyncConflictError,
  ShopifyIntegrationNotConnectedError,
} from '../services/integrations/shopify/shopifyErrors.js';

/**
 * Helper para extraer una cookie específica del encabezado req.headers.cookie
 */
function getCookie(req, name) {
  if (req.cookies && req.cookies[name]) {
    return req.cookies[name];
  }
  const raw = req.headers?.cookie;
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * GET /api/integrations/shopify/status
 * Devuelve el estado de la integración del tenant sin exponer credenciales.
 */
export async function getShopifyStatus(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Contexto de tenant no autenticado.' });
  }

  try {
    const integration = await prisma.integration.findUnique({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPIFY',
        },
      },
      select: {
        provider: true,
        status: true,
        shopDomain: true,
        scopes: true,
        accessTokenExpiresAt: true,
        lastSyncedAt: true,
        syncStatus: true,
        lastSyncError: true,
        catalogMode: true,
        priceSource: true,
        stockSource: true,
        externalOrderMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasAppConfig = Boolean(
      process.env.SHOPIFY_CLIENT_ID?.trim() &&
      process.env.SHOPIFY_CLIENT_SECRET?.trim()
    );
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI?.trim() || `${process.env.APP_URL || 'http://localhost:3000'}/api/integrations/shopify/callback`;

    if (!integration) {
      return res.json({
        provider: 'SHOPIFY',
        status: 'DISCONNECTED',
        stage: hasAppConfig ? 'READY_FOR_DEV_STORE' : 'CREDENTIALS_REQUIRED',
        isConfigured: hasAppConfig,
        redirectUri,
        shopDomain: null,
        scopes: [],
        accessTokenExpiresAt: null,
        lastSyncedAt: null,
        syncStatus: 'IDLE',
        lastSyncError: null,
      });
    }

    const isConnected = integration.status === 'CONNECTED';

    return res.json({
      provider: integration.provider,
      status: integration.status,
      stage: isConnected ? 'LIVE_CONNECTION_CONFIRMED' : (hasAppConfig ? 'READY_FOR_DEV_STORE' : 'CREDENTIALS_REQUIRED'),
      isConfigured: hasAppConfig,
      redirectUri,
      shopDomain: integration.shopDomain,
      scopes: integration.scopes,
      accessTokenExpiresAt: integration.accessTokenExpiresAt,
      lastSyncedAt: integration.lastSyncedAt,
      syncStatus: integration.syncStatus,
      lastSyncError: integration.lastSyncError,
      catalogMode: integration.catalogMode,
      priceSource: integration.priceSource,
      stockSource: integration.stockSource,
      externalOrderMode: integration.externalOrderMode,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    });
  } catch (error) {
    console.error('[Shopify] Error al obtener estado:', error.message);
    return res.status(500).json({ error: 'Error interno al consultar estado de Shopify.' });
  }
}

/**
 * POST/GET /api/integrations/shopify/connect
 * Inicia el flujo OAuth: valida dominio, comprueba unicidad y redirige (GET) o devuelve la authUrl (POST).
 */
export async function connectShopify(req, res) {
  let tenantId = req.user?.tenantId;
  let userId = req.user?.userId || req.user?.id;

  // Si no viene por authMiddleware (ej. navegación GET directa desde el navegador)
  if (!tenantId || !userId) {
    if (req.query?.token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET);
        tenantId = decoded.tenantId;
        userId = decoded.userId || decoded.id;
        if (decoded.role === 'superadmin' && req.query.tenantId) {
          tenantId = req.query.tenantId;
        }
      } catch (err) {
        return res.status(401).json({ error: 'Token JWT inválido en query.' });
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // En desarrollo / pruebas live con DB desechable, usar tenant sintético si no se provee otro
      tenantId = '8f156435-ad21-40dd-ba4e-a8767c495257';
      userId = '7a938d46-e99e-4e0c-895f-d5a95535ae4e';
    }
  }

  // Si es superadmin sin tenantId explícito, resolver primer tenant
  if (!tenantId && req.user?.role === 'superadmin') {
    if (req.query?.tenantId) {
      tenantId = req.query.tenantId;
    } else {
      const firstTenant = await prisma.tenant.findFirst({ select: { id: true } });
      if (firstTenant) tenantId = firstTenant.id;
    }
  }

  if (!tenantId || !userId) {
    return res.status(401).json({ error: 'Contexto de autenticación requerido.' });
  }

  const shopDomain = req.query?.shop || req.query?.shopDomain || req.body?.shopDomain;
  if (!shopDomain) {
    return res.status(400).json({ error: 'El campo shopDomain o shop es requerido.' });
  }

  const returnTo = req.query?.returnTo || req.body?.returnTo || null;

  try {
    const canonicalDomain = canonicalizeShopDomain(shopDomain);

    // Comprobar si la tienda está actualmente conectada a otro tenant
    const existing = await prisma.integration.findFirst({
      where: {
        provider: 'SHOPIFY',
        shopDomain: canonicalDomain,
        status: 'CONNECTED',
        NOT: { tenantId },
      },
      select: { id: true },
    });

    if (existing) {
      return res.status(409).json({
        error: `La tienda "${canonicalDomain}" ya está conectada a otra cuenta de Velion.`,
      });
    }

    const { authUrl, nonce, cookieOptions } = buildAuthorizationUrl({
      shopDomain: canonicalDomain,
      tenantId,
      userId,
      returnTo,
    });

    // Fijar cookie HttpOnly SameSite=Lax
    res.cookie(OAUTH_COOKIE_NAME, nonce, cookieOptions);

    if (req.method === 'GET') {
      return res.redirect(authUrl);
    }

    return res.json({
      authUrl,
      shopDomain: canonicalDomain,
    });
  } catch (error) {
    if (error instanceof ShopifyError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('[Shopify] Error al iniciar OAuth:', error.message);
    return res.status(500).json({ error: 'Error interno al iniciar conexión con Shopify.' });
  }
}

/**
 * GET /api/integrations/shopify/callback
 * Endpoint público al que redirige Shopify. Autentica mediante HMAC, State estricto y Cookie Nonce.
 */
export async function handleShopifyCallback(req, res) {
  const { code, shop, state, hmac } = req.query;

  const clearCookieOpts = getClearCookieOptions();

  // 1. Validar parámetros requeridos
  if (!code || !shop || !state || !hmac) {
    res.clearCookie(OAUTH_COOKIE_NAME, clearCookieOpts);
    return res.status(400).json({ error: 'Parámetros obligatorios de OAuth faltantes en el callback.' });
  }

  try {
    const cfg = getShopifyConfig({ requireSecret: true });

    // 2. Validar HMAC de Shopify en tiempo constante
    const isHmacValid = verifyOAuthHmac({
      query: req.query,
      clientSecret: cfg.clientSecret,
    });

    if (!isHmacValid) {
      res.clearCookie(OAUTH_COOKIE_NAME, clearCookieOpts);
      return res.status(400).json({ error: 'Firma HMAC de Shopify inválida o alterada.' });
    }

    // 3. Validar State y Nonce de la Cookie (Option B Single-Use)
    const cookieNonce = getCookie(req, OAUTH_COOKIE_NAME);
    const validatedState = verifyOAuthState({
      state,
      cookieNonce,
      shop,
    });

    // 4. Inmediatamente limpiar la cookie para garantizar single-use
    res.clearCookie(OAUTH_COOKIE_NAME, clearCookieOpts);

    // 5. Intercambiar authorization code por tokens offline expirables
    const tokenData = await exchangeAuthorizationCode({
      shopDomain: validatedState.shopDomain,
      code,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    });

    // 6. Persistir tokens atómicamente cifrados para el tenant autenticado en el state
    await persistConnectedTokens({
      tenantId: validatedState.tenantId,
      shopDomain: validatedState.shopDomain,
      tokenData,
    });

    // 7. Redirigir al frontend Vercel o destino validado
    let destination = validatedState.returnTo;
    const defaultFrontend = process.env.FRONTEND_URL || 'https://velion-agent.vercel.app';
    const defaultDestination = `${defaultFrontend.replace(/\/+$/, '')}/integraciones/shopify`;

    let finalRedirectUrl = defaultDestination;
    if (destination) {
      try {
        const parsed = new URL(destination);
        const allowedHosts = [
          'velion-agent.vercel.app',
          '185.163.116.210',
          'localhost',
          '127.0.0.1',
        ];
        if (process.env.FRONTEND_URL) {
          try {
            allowedHosts.push(new URL(process.env.FRONTEND_URL).hostname);
          } catch (_) {}
        }
        if (allowedHosts.includes(parsed.hostname)) {
          finalRedirectUrl = destination;
        }
      } catch (_) {
        finalRedirectUrl = defaultDestination;
      }
    }

    const separator = finalRedirectUrl.includes('?') ? '&' : '?';
    return res.redirect(`${finalRedirectUrl}${separator}shopify=connected&shop=${encodeURIComponent(validatedState.shopDomain)}`);
  } catch (error) {
    res.clearCookie(OAUTH_COOKIE_NAME, clearCookieOpts);

    if (error instanceof ShopifyDomainConflictError) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    if (error instanceof ShopifyOAuthError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }

    console.error('[Shopify Callback] Error procesando callback:', error.message);
    return res.status(500).json({ error: 'Error procesando la autorización de Shopify.' });
  }
}

/**
 * POST /api/integrations/shopify/disconnect
 * Desconecta la integración del tenant actual, revocando tokens en base de datos.
 */
export async function disconnectShopify(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Contexto de tenant requerido.' });
  }

  const { releaseDomain = false } = req.body || {};

  try {
    await disconnectIntegration({
      tenantId,
      releaseDomain: Boolean(releaseDomain),
    });

    return res.json({
      success: true,
      message: releaseDomain
        ? 'Integración desconectada y dominio liberado exitosamente.'
        : 'Integración desconectada exitosamente.',
    });
  } catch (error) {
    console.error('[Shopify] Error al desconectar:', error.message);
    return res.status(500).json({ error: 'Error interno al desconectar Shopify.' });
  }
}

/**
 * POST /api/integrations/shopify/sync
 * Dispara la sincronización manual del catálogo de Shopify para el tenant autenticado.
 */
export async function triggerShopifySync(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Contexto de tenant requerido.' });
  }

  try {
    const result = await syncShopifyCatalog(tenantId);
    return res.json({
      success: true,
      productsSynced: result.productsSynced,
      variantsSynced: result.variantsSynced,
      staleProductsDeleted: result.staleProductsDeleted,
      staleVariantsDeleted: result.staleVariantsDeleted,
      durationMs: result.durationMs,
    });
  } catch (error) {
    if (error instanceof ShopifySyncConflictError) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    if (error instanceof ShopifyIntegrationNotConnectedError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    if (error instanceof ShopifyError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('[Shopify Sync] Error durante la sincronización:', error.message);
    return res.status(500).json({ error: 'Error interno durante la sincronización de catálogo.' });
  }
}

/**
 * PATCH /api/integrations/shopify/settings
 * Actualiza la configuración de catálogo comercial de Shopify para el tenant autenticado.
 * Whitelist estricta: catalogMode, priceSource, stockSource.
 */
export async function updateShopifySettings(req, res) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Contexto de tenant requerido.' });
  }

  const { catalogMode, priceSource, stockSource } = req.body || {};

  const validCatalogModes = ['VELION_ONLY', 'SHOPIFY_ONLY', 'COMBINED'];
  const validSources = ['VELION', 'SHOPIFY'];

  const dataToUpdate = {};

  if (catalogMode !== undefined) {
    if (!validCatalogModes.includes(catalogMode)) {
      return res.status(400).json({
        error: `catalogMode inválido. Opciones permitidas: ${validCatalogModes.join(', ')}`,
        code: 'INVALID_CATALOG_MODE',
      });
    }
    dataToUpdate.catalogMode = catalogMode;
  }

  if (priceSource !== undefined) {
    if (!validSources.includes(priceSource)) {
      return res.status(400).json({
        error: `priceSource inválido. Opciones permitidas: ${validSources.join(', ')}`,
        code: 'INVALID_PRICE_SOURCE',
      });
    }
    dataToUpdate.priceSource = priceSource;
  }

  if (stockSource !== undefined) {
    if (!validSources.includes(stockSource)) {
      return res.status(400).json({
        error: `stockSource inválido. Opciones permitidas: ${validSources.join(', ')}`,
        code: 'INVALID_STOCK_SOURCE',
      });
    }
    dataToUpdate.stockSource = stockSource;
  }

  if (Object.keys(dataToUpdate).length === 0) {
    return res.status(400).json({ error: 'No se enviaron campos válidos para actualizar.' });
  }

  try {
    const existing = await prisma.integration.findUnique({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPIFY',
        },
      },
      select: { id: true, status: true },
    });

    if (!existing || existing.status !== 'CONNECTED') {
      return res.status(400).json({
        error: 'No existe una integración de Shopify activa para este comercio.',
        code: 'SHOPIFY_NOT_CONNECTED',
      });
    }

    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: dataToUpdate,
      select: {
        provider: true,
        status: true,
        catalogMode: true,
        priceSource: true,
        stockSource: true,
        updatedAt: true,
      },
    });

    return res.json({
      success: true,
      settings: updated,
    });
  } catch (error) {
    console.error('[Shopify Settings] Error al actualizar configuración:', error.message);
    return res.status(500).json({ error: 'Error interno al actualizar la configuración de Shopify.' });
  }
}


