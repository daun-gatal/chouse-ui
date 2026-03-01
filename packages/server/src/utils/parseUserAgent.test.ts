/**
 * Tests for User-Agent Parser & Client Info Extractor
 */

import { describe, expect, test } from 'bun:test';
import { parseUserAgent, extractClientInfo } from './parseUserAgent';

describe('parseUserAgent', () => {
    describe('Browser Detection', () => {
        test('should detect Chrome', () => {
            const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            expect(result.browser).toBe('Chrome');
            expect(result.browserVersion).toBe('120.0.0.0');
        });

        test('should detect Firefox', () => {
            const result = parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0');
            expect(result.browser).toBe('Firefox');
            expect(result.browserVersion).toBe('121.0');
        });

        test('should detect Safari', () => {
            const result = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15');
            expect(result.browser).toBe('Safari');
            expect(result.browserVersion).toBe('17.2');
        });

        test('should detect Edge', () => {
            const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91');
            expect(result.browser).toBe('Edge');
            expect(result.browserVersion).toBe('120.0.2210.91');
        });

        test('should detect Opera', () => {
            const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0');
            expect(result.browser).toBe('Opera');
            expect(result.browserVersion).toBe('106.0.0.0');
        });

        test('should detect Samsung Browser', () => {
            const result = parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36');
            expect(result.browser).toBe('Samsung Browser');
            expect(result.browserVersion).toBe('23.0');
        });

        test('should detect curl', () => {
            const result = parseUserAgent('curl/8.4.0');
            expect(result.browser).toBe('curl');
            expect(result.browserVersion).toBe('8.4.0');
        });

        test('should detect Postman', () => {
            const result = parseUserAgent('PostmanRuntime/7.36.0');
            expect(result.browser).toBe('Postman');
            expect(result.browserVersion).toBe('7.36.0');
        });

        test('should return null for empty UA', () => {
            const result = parseUserAgent('');
            expect(result.browser).toBeNull();
            expect(result.browserVersion).toBeNull();
        });

        test('should return null for undefined UA', () => {
            const result = parseUserAgent(undefined);
            expect(result.browser).toBeNull();
        });
    });

    describe('OS Detection', () => {
        test('should detect Windows 10/11', () => {
            const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            expect(result.os).toBe('Windows');
            expect(result.osVersion).toBe('10/11');
        });

        test('should detect Windows 7', () => {
            const result = parseUserAgent('Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36');
            expect(result.os).toBe('Windows');
            expect(result.osVersion).toBe('7');
        });

        test('should detect macOS with version', () => {
            const result = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15');
            expect(result.os).toBe('macOS');
            expect(result.osVersion).toBe('14.2');
        });

        test('should detect macOS with underscore version', () => {
            const result = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
            expect(result.os).toBe('macOS');
            expect(result.osVersion).toBe('10.15.7');
        });

        test('should detect iOS', () => {
            const result = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15');
            expect(result.os).toBe('iOS');
            expect(result.osVersion).toBe('17.2');
        });

        test('should detect Android', () => {
            const result = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36');
            expect(result.os).toBe('Android');
            expect(result.osVersion).toBe('14');
        });

        test('should detect Linux', () => {
            const result = parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0');
            expect(result.os).toBe('Linux');
            expect(result.osVersion).toBeNull();
        });

        test('should detect Chrome OS', () => {
            const result = parseUserAgent('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36');
            expect(result.os).toBe('Chrome OS');
            expect(result.osVersion).toBe('14541.0.0');
        });
    });

    describe('Device Type Detection', () => {
        test('should detect Desktop (Windows)', () => {
            const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0');
            expect(result.deviceType).toBe('Desktop');
        });

        test('should detect Desktop (macOS)', () => {
            const result = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15');
            expect(result.deviceType).toBe('Desktop');
        });

        test('should detect Mobile (iPhone)', () => {
            const result = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
            expect(result.deviceType).toBe('Mobile');
        });

        test('should detect Mobile (Android)', () => {
            const result = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36');
            expect(result.deviceType).toBe('Mobile');
        });

        test('should detect Tablet (iPad)', () => {
            const result = parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15');
            expect(result.deviceType).toBe('Tablet');
        });

        test('should detect Tablet (Android tablet)', () => {
            const result = parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X810) AppleWebKit/537.36');
            expect(result.deviceType).toBe('Tablet');
        });

        test('should detect Bot (Googlebot)', () => {
            const result = parseUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
            expect(result.deviceType).toBe('Bot');
        });

        test('should detect Bot (curl)', () => {
            const result = parseUserAgent('curl/8.4.0');
            expect(result.deviceType).toBe('Bot');
        });

        test('should return Unknown for empty UA', () => {
            const result = parseUserAgent('');
            expect(result.deviceType).toBe('Unknown');
        });
    });
});

describe('parseUserAgent — Architecture', () => {
    test('should detect x86_64 from Win64', () => {
        const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0');
        expect(result.architecture).toBe('x86_64');
    });

    test('should detect x86_64 from x86_64 in UA', () => {
        const result = parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0');
        expect(result.architecture).toBe('x86_64');
    });

    test('should detect WOW64', () => {
        const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 Chrome/120.0.0.0');
        expect(result.architecture).toBe('x86 (WOW64)');
    });

    test('should detect ARM64', () => {
        const result = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ARM64 Chrome/120.0.0.0');
        expect(result.architecture).toBe('ARM64');
    });

    test('should return null for UA with no architecture token', () => {
        const result = parseUserAgent('curl/8.4.0');
        expect(result.architecture).toBeNull();
    });
});

describe('parseUserAgent — Device Model', () => {
    test('should detect Samsung device', () => {
        const result = parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36');
        expect(result.deviceModel).toBe('Samsung SM-S918B');
    });

    test('should detect Pixel device', () => {
        const result = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
        expect(result.deviceModel).toBe('Pixel 8');
    });

    test('should detect iPhone', () => {
        const result = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
        expect(result.deviceModel).toBe('iPhone');
    });

    test('should detect iPad', () => {
        const result = parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15');
        expect(result.deviceModel).toBe('iPad');
    });

    test('should return null for desktop UA', () => {
        const result = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0');
        expect(result.deviceModel).toBeNull();
    });
});

describe('extractClientInfo', () => {
    test('should extract full client info with Cloudflare headers', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 Chrome/120.0.0.0',
            acceptLanguage: 'en-US,en;q=0.9,id;q=0.8',
            cfIpCountry: 'ID',
            cfIpCity: 'Jakarta',
        });

        expect(result.browser).toBe('Chrome');
        expect(result.browserVersion).toBe('120.0.0.0');
        expect(result.os).toBe('macOS');
        expect(result.osVersion).toBe('14.2');
        expect(result.deviceType).toBe('Desktop');
        expect(result.language).toBe('en-US');
        expect(result.country).toBe('ID');
        expect(result.city).toBe('Jakarta');
    });

    test('should use Vercel country header as fallback', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            vercelIpCountry: 'US',
            vercelIpCity: 'New York',
            vercelIpCountryRegion: 'NY',
            vercelIpTimezone: 'America/New_York',
        });
        expect(result.country).toBe('US');
        expect(result.city).toBe('New York');
        expect(result.countryRegion).toBe('NY');
        expect(result.timezone).toBe('America/New_York');
    });

    test('should prefer CF country over Vercel', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            cfIpCountry: 'SG',
            vercelIpCountry: 'US',
        });
        expect(result.country).toBe('SG');
    });

    test('should parse country from CloudFront headers', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            cloudfrontCountry: 'JP',
            cloudfrontCity: 'Tokyo',
            cloudfrontCountryRegion: '13',
            cloudfrontTimezone: 'Asia/Tokyo',
        });
        expect(result.country).toBe('JP');
        expect(result.city).toBe('Tokyo');
        expect(result.countryRegion).toBe('13');
        expect(result.timezone).toBe('Asia/Tokyo');
    });

    test('should parse country from Fastly header', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            fastlyCountry: 'DE',
        });
        expect(result.country).toBe('DE');
    });

    test('should parse Akamai Edgescape header', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            akamaiEdgescape: 'georegion=246,country_code=ID,region_code=JK,city=JAKARTA,dma=0,pmsa=0,msa=0,areacode=0,lat=-6.2146,long=106.8451,county=0,continent=AS,timezone=Asia%2FJakarta',
        });
        expect(result.country).toBe('ID');
        expect(result.city).toBe('JAKARTA');
        expect(result.countryRegion).toBe('JK');
        expect(result.timezone).toBe('Asia/Jakarta');
    });

    test('should parse country from nginx GeoIP header', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            nginxGeoipCountry: 'AU',
        });
        expect(result.country).toBe('AU');
    });

    test('should fall back to Accept-Language for country when no CDN header', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            acceptLanguage: 'id-ID,id;q=0.9,en-US;q=0.8',
        });
        expect(result.country).toBe('ID');
        expect(result.language).toBe('id-ID');
    });

    test('should fall back to Accept-Language country for en-US', () => {
        const result = extractClientInfo({
            acceptLanguage: 'en-US',
        });
        expect(result.country).toBe('US');
    });

    test('should return null country for language with no region tag', () => {
        const result = extractClientInfo({
            acceptLanguage: 'ja',
        });
        expect(result.country).toBeNull();
    });

    test('should handle missing headers gracefully', () => {
        const result = extractClientInfo({});
        expect(result.browser).toBeNull();
        expect(result.os).toBeNull();
        expect(result.language).toBeNull();
        expect(result.country).toBeNull();
        expect(result.city).toBeNull();
        expect(result.countryRegion).toBeNull();
        expect(result.timezone).toBeNull();
        expect(result.deviceModel).toBeNull();
        expect(result.architecture).toBeNull();
        expect(result.deviceType).toBe('Unknown');
    });

    test('should parse language from Accept-Language', () => {
        const result = extractClientInfo({
            acceptLanguage: 'id-ID,id;q=0.9,en-US;q=0.8',
        });
        expect(result.language).toBe('id-ID');
    });

    test('should handle simple Accept-Language', () => {
        const result = extractClientInfo({
            acceptLanguage: 'ja',
        });
        expect(result.language).toBe('ja');
    });
});
