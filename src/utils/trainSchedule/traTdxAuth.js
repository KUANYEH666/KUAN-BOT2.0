const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

let tokenCache = null;

function hasTdxCredentials() {
  return !!(
    process.env.TDX_ACCESS_TOKEN ||
    process.env.TDX_API_KEY ||
    (process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET)
  );
}

async function getTdxAccessToken() {
  if (process.env.TDX_ACCESS_TOKEN) {
    console.log('[tdxAuth] token success');
    return process.env.TDX_ACCESS_TOKEN;
  }
  if (process.env.TDX_API_KEY) {
    console.log('[tdxAuth] token success');
    return process.env.TDX_API_KEY;
  }

  if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
    console.warn('[tdxAuth] token failed: missing TDX_CLIENT_ID or TDX_CLIENT_SECRET');
    return null;
  }

  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    console.log('[tdxAuth] token success');
    return tokenCache.token;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TDX_CLIENT_ID,
      client_secret: process.env.TDX_CLIENT_SECRET
    });

    const response = await fetch(TDX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      throw new Error(`TDX token HTTP ${response.status}`);
    }

    const payload = await response.json();
    const expiresIn = Number(payload.expires_in || 3600);
    tokenCache = {
      token: payload.access_token,
      expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000
    };

    console.log('[tdxAuth] token success');
    return tokenCache.token;
  } catch (error) {
    console.warn(`[tdxAuth] token failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  getTdxAccessToken,
  hasTdxCredentials
};
