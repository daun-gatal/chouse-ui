/**
 * User-Agent Parser & Client Info Extractor
 *
 * Lightweight regex-based parser — zero external dependencies.
 * Extracts browser, OS, device type, architecture, and device model
 * from User-Agent strings, plus language, country, timezone, city,
 * and country region from HTTP headers across all major CDN providers.
 *
 * Supported CDN country sources (in priority order):
 *   1. Cloudflare   — CF-IPCountry
 *   2. Vercel       — X-Vercel-IP-Country
 *   3. AWS CloudFront — CloudFront-Viewer-Country
 *   4. Fastly       — X-Country-Code
 *   5. Akamai       — X-Akamai-Edgescape (parsed: country_code=XX)
 *   6. Nginx GeoIP  — X-GeoIP-Country / X-Real-Country
 *   7. Fallback     — Accept-Language region tag (e.g. "id-ID" → "ID")
 */

export interface ParsedUserAgent {
    browser: string | null;
    browserVersion: string | null;
    os: string | null;
    osVersion: string | null;
    deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown';
    /** CPU / platform architecture extracted from UA (e.g. "x86_64", "ARM64", "Win64") */
    architecture: string | null;
    /** Device brand/model for mobile devices (e.g. "Samsung SM-S918B", "Pixel 8") */
    deviceModel: string | null;
}

export interface ClientInfo extends ParsedUserAgent {
    language: string | null;
    /** ISO 3166-1 alpha-2 country code, resolved from CDN headers or Accept-Language */
    country: string | null;
    /** IANA timezone identifier (e.g. "Asia/Jakarta"), available from some CDNs */
    timezone: string | null;
    /** City name, available from some CDNs */
    city: string | null;
    /** Country subdivision / region code (e.g. "JK", "CA"), available from some CDNs */
    countryRegion: string | null;
}

/**
 * Parse a User-Agent string into structured components.
 */
export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
    if (!ua) {
        return {
            browser: null,
            browserVersion: null,
            os: null,
            osVersion: null,
            deviceType: 'Unknown',
            architecture: null,
            deviceModel: null,
        };
    }

    return {
        ...parseBrowser(ua),
        ...parseOS(ua),
        deviceType: parseDeviceType(ua),
        architecture: parseArchitecture(ua),
        deviceModel: parseDeviceModel(ua),
    };
}

/**
 * Extract full client info from HTTP headers.
 * Combines UA parsing with header-based geo/locale data.
 */
export function extractClientInfo(headers: {
    userAgent?: string | null;
    acceptLanguage?: string | null;
    // Cloudflare
    cfIpCountry?: string | null;
    cfIpCity?: string | null;
    // Vercel
    vercelIpCountry?: string | null;
    vercelIpCountryRegion?: string | null;
    vercelIpCity?: string | null;
    vercelIpTimezone?: string | null;
    // AWS CloudFront
    cloudfrontCountry?: string | null;
    cloudfrontCountryRegion?: string | null;
    cloudfrontCity?: string | null;
    cloudfrontTimezone?: string | null;
    // Fastly
    fastlyCountry?: string | null;
    // Akamai
    akamaiEdgescape?: string | null;
    // Nginx GeoIP modules
    nginxGeoipCountry?: string | null;
}): ClientInfo {
    const parsed = parseUserAgent(headers.userAgent);

    // Parse Akamai Edgescape once and reuse
    const akamaiGeo = parseAkamaiEdgescape(headers.akamaiEdgescape);

    const country =
        headers.cfIpCountry ||
        headers.vercelIpCountry ||
        headers.cloudfrontCountry ||
        headers.fastlyCountry ||
        akamaiGeo?.country ||
        headers.nginxGeoipCountry ||
        parseCountryFromLanguage(headers.acceptLanguage) ||
        null;

    const city =
        headers.cfIpCity ||
        headers.vercelIpCity ||
        headers.cloudfrontCity ||
        akamaiGeo?.city ||
        null;

    const countryRegion =
        headers.vercelIpCountryRegion ||
        headers.cloudfrontCountryRegion ||
        akamaiGeo?.region ||
        null;

    const timezone =
        headers.vercelIpTimezone ||
        headers.cloudfrontTimezone ||
        akamaiGeo?.timezone ||
        null;

    return {
        ...parsed,
        language: parseLanguage(headers.acceptLanguage),
        country,
        city,
        countryRegion,
        timezone,
    };
}

/**
 * Extract all relevant headers from a Hono context for audit log enrichment.
 */
export function getClientHeaders(c: { req: { header: (name: string) => string | undefined } }): {
    userAgent: string | undefined;
    acceptLanguage: string | undefined;
    // Cloudflare
    cfIpCountry: string | undefined;
    cfIpCity: string | undefined;
    // Vercel
    vercelIpCountry: string | undefined;
    vercelIpCountryRegion: string | undefined;
    vercelIpCity: string | undefined;
    vercelIpTimezone: string | undefined;
    // AWS CloudFront
    cloudfrontCountry: string | undefined;
    cloudfrontCountryRegion: string | undefined;
    cloudfrontCity: string | undefined;
    cloudfrontTimezone: string | undefined;
    // Fastly
    fastlyCountry: string | undefined;
    // Akamai
    akamaiEdgescape: string | undefined;
    // Nginx GeoIP
    nginxGeoipCountry: string | undefined;
    // IP
    ipAddress: string | undefined;
} {
    return {
        userAgent: c.req.header('User-Agent'),
        acceptLanguage: c.req.header('Accept-Language'),
        // Cloudflare
        cfIpCountry: c.req.header('CF-IPCountry'),
        cfIpCity: c.req.header('CF-IPCity'),
        // Vercel
        vercelIpCountry: c.req.header('X-Vercel-IP-Country'),
        vercelIpCountryRegion: c.req.header('X-Vercel-IP-Country-Region'),
        vercelIpCity: c.req.header('X-Vercel-IP-City'),
        vercelIpTimezone: c.req.header('X-Vercel-IP-Timezone'),
        // AWS CloudFront
        cloudfrontCountry: c.req.header('CloudFront-Viewer-Country'),
        cloudfrontCountryRegion: c.req.header('CloudFront-Viewer-Country-Region'),
        cloudfrontCity: c.req.header('CloudFront-Viewer-City'),
        cloudfrontTimezone: c.req.header('CloudFront-Viewer-Time-Zone'),
        // Fastly
        fastlyCountry: c.req.header('X-Country-Code'),
        // Akamai Edgescape header (contains multiple geo fields in one string)
        akamaiEdgescape: c.req.header('X-Akamai-Edgescape'),
        // Nginx with ngx_http_geoip_module
        nginxGeoipCountry: c.req.header('X-GeoIP-Country') || c.req.header('X-Real-Country'),
        // Client IP (prefer X-Forwarded-For, fallback to X-Real-IP)
        ipAddress: c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    };
}

// ============================================
// Browser Detection
// ============================================

function parseBrowser(ua: string): { browser: string | null; browserVersion: string | null } {
    // Order matters — check specific browsers before generic ones

    // Edge (Chromium-based)
    let match = ua.match(/Edg(?:e|A|iOS)?\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Edge', browserVersion: match[1] };

    // Opera / OPR
    match = ua.match(/(?:OPR|Opera)\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Opera', browserVersion: match[1] };

    // Samsung Browser
    match = ua.match(/SamsungBrowser\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Samsung Browser', browserVersion: match[1] };

    // Brave (identifies as Chrome but has Brave in UA)
    if (ua.includes('Brave')) {
        match = ua.match(/Chrome\/(\d+(?:\.\d+)*)/);
        return { browser: 'Brave', browserVersion: match?.[1] || null };
    }

    // Vivaldi
    match = ua.match(/Vivaldi\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Vivaldi', browserVersion: match[1] };

    // Firefox
    match = ua.match(/Firefox\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Firefox', browserVersion: match[1] };

    // Chrome (must be after Edge, Opera, Samsung, Brave, Vivaldi)
    match = ua.match(/Chrome\/(\d+(?:\.\d+)*)/);
    if (match && !ua.includes('Chromium')) return { browser: 'Chrome', browserVersion: match[1] };

    // Chromium
    match = ua.match(/Chromium\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Chromium', browserVersion: match[1] };

    // Safari (must be after Chrome — Chrome also contains "Safari")
    match = ua.match(/Version\/(\d+(?:\.\d+)*)\s+Safari/);
    if (match) return { browser: 'Safari', browserVersion: match[1] };

    // Safari without version
    if (ua.includes('Safari') && !ua.includes('Chrome')) {
        return { browser: 'Safari', browserVersion: null };
    }

    // curl
    match = ua.match(/curl\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'curl', browserVersion: match[1] };

    // Postman
    match = ua.match(/PostmanRuntime\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Postman', browserVersion: match[1] };

    // Insomnia
    match = ua.match(/insomnia\/(\d+(?:\.\d+)*)/);
    if (match) return { browser: 'Insomnia', browserVersion: match[1] };

    return { browser: null, browserVersion: null };
}

// ============================================
// OS Detection
// ============================================

function parseOS(ua: string): { os: string | null; osVersion: string | null } {
    // iOS (check before macOS — iOS UAs contain "Mac OS X")
    let match = ua.match(/(?:iPhone|iPad|iPod).*?OS (\d+[._]\d+(?:[._]\d+)?)/);
    if (match) {
        const version = match[1].replace(/_/g, '.');
        return { os: 'iOS', osVersion: version };
    }

    // Windows
    match = ua.match(/Windows NT (\d+\.\d+)/);
    if (match) {
        const ntVersion = match[1];
        const windowsVersionMap: Record<string, string> = {
            '10.0': '10/11',
            '6.3': '8.1',
            '6.2': '8',
            '6.1': '7',
            '6.0': 'Vista',
            '5.1': 'XP',
        };
        return { os: 'Windows', osVersion: windowsVersionMap[ntVersion] || ntVersion };
    }

    // macOS / Mac OS X
    match = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/);
    if (match) {
        const version = match[1].replace(/_/g, '.');
        return { os: 'macOS', osVersion: version };
    }
    if (ua.includes('Macintosh') || ua.includes('Mac OS')) {
        return { os: 'macOS', osVersion: null };
    }

    // Android
    match = ua.match(/Android (\d+(?:\.\d+)*)/);
    if (match) return { os: 'Android', osVersion: match[1] };

    // Chrome OS
    if (ua.includes('CrOS')) {
        match = ua.match(/CrOS\s+\S+\s+(\d+(?:\.\d+)*)/);
        return { os: 'Chrome OS', osVersion: match?.[1] || null };
    }

    // Linux (generic — after Android and Chrome OS)
    if (ua.includes('Linux')) {
        return { os: 'Linux', osVersion: null };
    }

    // FreeBSD
    if (ua.includes('FreeBSD')) {
        return { os: 'FreeBSD', osVersion: null };
    }

    return { os: null, osVersion: null };
}

// ============================================
// Device Type Detection
// ============================================

function parseDeviceType(ua: string): ParsedUserAgent['deviceType'] {
    // Bots / crawlers
    if (/bot|crawler|spider|slurp|Googlebot|Bingbot|Baiduspider|facebookexternalhit|Twitterbot|LinkedInBot/i.test(ua)) {
        return 'Bot';
    }

    // API clients
    if (/curl|PostmanRuntime|insomnia|httpie|wget/i.test(ua)) {
        return 'Bot';
    }

    // Tablets (check before mobile — tablets often include "Mobile" too)
    if (/iPad|tablet|playbook|silk|kindle/i.test(ua)) {
        return 'Tablet';
    }
    // Android tablet (Android without "Mobile")
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) {
        return 'Tablet';
    }

    // Mobile
    if (/iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini|Opera Mobi|Windows Phone/i.test(ua)) {
        return 'Mobile';
    }

    // Desktop (everything else with a known OS)
    if (/Windows NT|Macintosh|Mac OS|Linux|CrOS|FreeBSD/i.test(ua)) {
        return 'Desktop';
    }

    return 'Unknown';
}

// ============================================
// Architecture Detection
// ============================================

/**
 * Extract CPU / platform architecture from User-Agent.
 * e.g. "Win64", "x86_64", "ARM64", "WOW64" (32-bit app on 64-bit Windows)
 */
function parseArchitecture(ua: string): string | null {
    // ARM64 / Apple Silicon
    if (/ARM64|aarch64/i.test(ua)) return 'ARM64';

    // WOW64 = 32-bit process on 64-bit Windows
    if (ua.includes('WOW64')) return 'x86 (WOW64)';

    // Win64 or explicit x86_64
    if (ua.includes('Win64') || ua.includes('x86_64') || ua.includes('x64')) return 'x86_64';

    // 32-bit Windows (Win32 without Win64/WOW64)
    if (ua.includes('Win32')) return 'x86';

    // ARM (generic, lower priority than ARM64)
    if (/\bARM\b/i.test(ua)) return 'ARM';

    return null;
}

// ============================================
// Device Model Detection
// ============================================

/**
 * Extract device brand/model for mobile and tablet devices.
 * Returns null for desktop platforms.
 */
function parseDeviceModel(ua: string): string | null {
    // Samsung devices: "SM-S918B", "SM-G998B", etc.
    let match = ua.match(/;\s*(SM-[A-Z0-9]+)/);
    if (match) return `Samsung ${match[1]}`;

    // Google Pixel: "Pixel 8", "Pixel 8 Pro", "Pixel Tablet"
    match = ua.match(/;\s*(Pixel\s+[\w\s]+?)(?:\s+Build|\))/);
    if (match) return match[1].trim();

    // Huawei
    match = ua.match(/;\s*((?:HW[A-Z0-9\-]+|[A-Z]{3}-[A-Z0-9]+))\s+Build/);
    if (match) return `Huawei ${match[1]}`;

    // Xiaomi / Redmi / POCO
    match = ua.match(/;\s*((?:Redmi|POCO|Mi)\s+[\w\s]+?)(?:\s+Build|\))/i);
    if (match) return match[1].trim();

    // OnePlus
    match = ua.match(/;\s*((?:OP|IN|BE)\d[A-Z0-9]+)\s+Build/);
    if (match) return `OnePlus ${match[1]}`;

    // iPhone — model is not in the UA, only OS version
    if (/iPhone/i.test(ua)) return 'iPhone';

    // iPad
    if (/iPad/i.test(ua)) return 'iPad';

    // iPod
    if (/iPod/i.test(ua)) return 'iPod';

    // Generic Android model fallback: "Android X.X; ModelName Build/..."
    match = ua.match(/Android[\s/][\d.]+;\s+([^;)]+?)(?:\s+Build|\))/);
    if (match) {
        const model = match[1].trim();
        // Ignore generic strings like "Linux armv8l"
        if (model && !/Linux|armv/i.test(model)) return model;
    }

    return null;
}

// ============================================
// Language Extraction
// ============================================

/**
 * Parse the primary language from Accept-Language header.
 * e.g. "en-US,en;q=0.9,id;q=0.8" → "en-US"
 */
function parseLanguage(acceptLanguage: string | undefined | null): string | null {
    if (!acceptLanguage) return null;

    // Get the first language (highest priority)
    const primary = acceptLanguage.split(',')[0]?.trim();
    if (!primary) return null;

    // Remove quality factor if present
    const lang = primary.split(';')[0]?.trim();
    return lang || null;
}

// ============================================
// Country Helpers
// ============================================

/**
 * Parse Akamai's X-Akamai-Edgescape header into geo components.
 * Format: "georegion=246,country_code=ID,region_code=JK,city=JAKARTA,dma=0,pmsa=0,msa=0,areacode=0,lat=-6.2146,long=106.8451,county=0,continent=AS,timezone=Asia%2FJakarta"
 */
function parseAkamaiEdgescape(edgescape: string | undefined | null): {
    country: string | null;
    city: string | null;
    region: string | null;
    timezone: string | null;
} | null {
    if (!edgescape) return null;

    const get = (key: string): string | null => {
        const match = edgescape.match(new RegExp(`${key}=([^,]+)`));
        if (!match) return null;
        return decodeURIComponent(match[1]).trim() || null;
    };

    const country = get('country_code');
    const city = get('city');
    const region = get('region_code');
    const timezone = get('timezone');

    // Return null if nothing was parsed
    if (!country && !city && !region && !timezone) return null;

    return { country, city, region, timezone };
}

/**
 * Derive a likely country code from the region subtag of Accept-Language.
 * e.g. "id-ID,id;q=0.9" → "ID"  |  "en-US" → "US"  |  "ja" → null
 *
 * This is a best-effort fallback — language region ≠ physical location,
 * but it is far better than returning null when no CDN geo header is present.
 */
function parseCountryFromLanguage(acceptLanguage: string | undefined | null): string | null {
    if (!acceptLanguage) return null;

    const primary = acceptLanguage.split(',')[0]?.trim().split(';')[0]?.trim();
    if (!primary) return null;

    const parts = primary.split('-');
    if (parts.length >= 2) {
        const region = parts[parts.length - 1].toUpperCase();
        // Only accept standard 2-letter ISO 3166-1 codes
        if (/^[A-Z]{2}$/.test(region)) return region;
    }

    return null;
}
