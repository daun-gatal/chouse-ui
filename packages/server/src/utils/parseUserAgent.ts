/**
 * User-Agent Parser & Client Info Extractor
 *
 * Lightweight regex-based parser — zero external dependencies.
 * Extracts browser, OS, device type from User-Agent strings,
 * plus language and country from HTTP headers.
 */

export interface ParsedUserAgent {
    browser: string | null;
    browserVersion: string | null;
    os: string | null;
    osVersion: string | null;
    deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown';
}

export interface ClientInfo extends ParsedUserAgent {
    language: string | null;
    country: string | null;
}

/**
 * Parse a User-Agent string into structured components.
 */
export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
    if (!ua) {
        return { browser: null, browserVersion: null, os: null, osVersion: null, deviceType: 'Unknown' };
    }

    return {
        ...parseBrowser(ua),
        ...parseOS(ua),
        deviceType: parseDeviceType(ua),
    };
}

/**
 * Extract full client info from a Hono context object.
 * Combines UA parsing with header-based data (language, country).
 */
export function extractClientInfo(headers: {
    userAgent?: string | null;
    acceptLanguage?: string | null;
    cfIpCountry?: string | null;
    vercelIpCountry?: string | null;
}): ClientInfo {
    const parsed = parseUserAgent(headers.userAgent);

    return {
        ...parsed,
        language: parseLanguage(headers.acceptLanguage),
        country: headers.cfIpCountry || headers.vercelIpCountry || null,
    };
}

/**
 * Helper to extract relevant headers from a Hono context.
 */
export function getClientHeaders(c: { req: { header: (name: string) => string | undefined } }): {
    userAgent: string | undefined;
    acceptLanguage: string | undefined;
    cfIpCountry: string | undefined;
    vercelIpCountry: string | undefined;
    ipAddress: string | undefined;
} {
    return {
        userAgent: c.req.header('User-Agent'),
        acceptLanguage: c.req.header('Accept-Language'),
        cfIpCountry: c.req.header('CF-IPCountry'),
        vercelIpCountry: c.req.header('X-Vercel-IP-Country'),
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
