/**
 * Trade Republic API client (read-only, web-login flow).
 *
 * Holds a mutable cookie jar + WAF token and knows how to:
 *   - start login (phone + pin) -> processId
 *   - complete login with the 2FA code
 *   - keep the 300s tr_session JWT fresh
 *   - call read-only /api-gateway endpoints
 *
 * See ../../README.md for the full protocol write-up.
 */

const BASE = 'https://api.traderepublic.com';
const REFRESH_MARGIN_MS = 60_000; // refresh 60s before the 300s JWT expires

export class TRClient {
  constructor() {
    /** @type {Map<string,string>} */
    this.jar = new Map();
    this.wafToken = null;
    this.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
    this.appVersion = '15.65.6';
    /** Called after login/verify/refresh so callers can persist the jar. */
    this.onUpdate = null;
  }

  /** Seed the jar + WAF token from the headless-browser bootstrap or disk. */
  seedFromWaf({ wafToken, userAgent, cookies }) {
    if (wafToken) this.wafToken = wafToken;
    if (userAgent) this.userAgent = userAgent;
    for (const { name, value } of cookies ?? []) this.jar.set(name, value);
  }

  /** Serialize everything needed to resume the session later (persist to disk). */
  export() {
    return {
      cookies: [...this.jar.entries()].map(([name, value]) => ({ name, value })),
      userAgent: this.userAgent,
      wafToken: this.wafToken,
    };
  }

  /**
   * True when we hold a session that can be used or refreshed — NOT just when the
   * 5-minute JWT is currently valid. The JWT expiring is normal; `ensureSession`
   * mints a new one via the refresh cookie on the next call. Treating an expired
   * JWT as "logged out" would force a re-login every 5 minutes.
   */
  get isLoggedIn() {
    return this.jar.has('tr_refresh') || this.jar.has('tr_session');
  }

  // --- low-level ----------------------------------------------------------
  cookieHeader() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  headers(extra = {}) {
    return {
      accept: '*/*',
      'accept-language': 'en',
      'content-type': 'application/json',
      origin: 'https://app.traderepublic.com',
      cookie: this.cookieHeader(),
      'user-agent': this.userAgent,
      'x-aws-waf-token': this.wafToken ?? '',
      'x-tr-app-version': this.appVersion,
      'x-tr-platform': 'web',
      ...extra,
    };
  }

  absorbSetCookie(res) {
    const cookies = res.headers.getSetCookie?.() ?? [];
    for (const raw of cookies) {
      const first = raw.split(';', 1)[0];
      const i = first.indexOf('=');
      if (i > 0) this.jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
    }
  }

  static decodeJwt(token) {
    try {
      const [, payload] = token.split('.');
      return JSON.parse(
        Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
          'utf8',
        ),
      );
    } catch {
      return null;
    }
  }

  sessionTtlMs() {
    const claims = TRClient.decodeJwt(this.jar.get('tr_session') ?? '');
    return claims?.exp ? Math.max(0, claims.exp * 1000 - Date.now()) : 0;
  }

  claims() {
    return TRClient.decodeJwt(this.jar.get('tr_session') ?? '');
  }

  secAccNo() {
    return this.claims()?.act?.acc?.owner?.default?.sec?.[0];
  }

  cashAccNo() {
    return this.claims()?.act?.acc?.owner?.default?.cash?.[0];
  }

  async #request(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 403 || res.status === 405) {
      const err = new Error(`WAF challenge (HTTP ${res.status}) on ${path}`);
      err.code = 'WAF';
      throw err;
    }
    this.absorbSetCookie(res);
    return res;
  }

  // --- auth ---------------------------------------------------------------
  /** Step 1: start login. Returns { processId, twoFa, countdownInSeconds }. */
  async login(phoneNumber, pin) {
    const res = await this.#request('POST', '/api/v1/auth/web/login', {
      phoneNumber,
      pin,
    });
    if (!res.ok) throw new Error(`login failed: HTTP ${res.status} ${await res.text()}`);
    const data = await res.json();
    return {
      processId: data.processId,
      twoFa: data['2fa'] ?? 'APP',
      countdownInSeconds: data.countdownInSeconds,
    };
  }

  /** Step 3: complete login with the 4-digit code. Sets tr_session cookies. */
  async verify(processId, code) {
    const res = await this.#request(
      'POST',
      `/api/v1/auth/web/login/${processId}/${code}`,
    );
    if (!res.ok) throw new Error(`verify failed: HTTP ${res.status} ${await res.text()}`);
    if (!this.isLoggedIn) throw new Error('verify returned OK but no session cookie set');
    this.onUpdate?.();
    return { ttlMs: this.sessionTtlMs(), secAccNo: this.secAccNo() };
  }

  async resend(processId) {
    const res = await this.#request('POST', `/api/v1/auth/web/login/${processId}/resend`);
    if (!res.ok) throw new Error(`resend failed: HTTP ${res.status}`);
  }

  /** Refresh the short-lived tr_session JWT. */
  async refreshSession() {
    const res = await this.#request('GET', '/api/v1/auth/web/session');
    if (!res.ok) {
      const err = new Error(`session refresh failed: HTTP ${res.status} — re-login required`);
      err.code = 'REAUTH';
      throw err;
    }
    this.onUpdate?.();
    return this.sessionTtlMs();
  }

  async ensureSession() {
    if (this.sessionTtlMs() <= REFRESH_MARGIN_MS) await this.refreshSession();
  }

  // --- read-only data -----------------------------------------------------
  async getChart({ range = '1d', currency = 'EUR' } = {}) {
    await this.ensureSession();
    const sec = this.secAccNo();
    if (!sec) throw new Error('no securities account number in session');
    const res = await this.#request(
      'GET',
      `/api-gateway/portfolio-chart/v2/chart?secAccNo=${encodeURIComponent(sec)}` +
        `&range=${range}&currency=${currency}`,
    );
    if (!res.ok) throw new Error(`chart failed: HTTP ${res.status}`);
    return res.json();
  }

  /** Feature flags from the session JWT, as plain strings. */
  features() {
    return (this.claims()?.featuresEnabled ?? []).map((f) => f.feature).filter(Boolean);
  }

  /** Account settings / personal details (incl. the cash IBAN, when present). */
  async getAccountInfo() {
    await this.ensureSession();
    const res = await this.#request('GET', '/api/v2/auth/account');
    if (!res.ok) throw new Error(`account info failed: HTTP ${res.status}`);
    return res.json();
  }
}
