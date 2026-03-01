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

describe('extractClientInfo', () => {
    test('should extract full client info', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 Chrome/120.0.0.0',
            acceptLanguage: 'en-US,en;q=0.9,id;q=0.8',
            cfIpCountry: 'ID',
        });

        expect(result.browser).toBe('Chrome');
        expect(result.browserVersion).toBe('120.0.0.0');
        expect(result.os).toBe('macOS');
        expect(result.osVersion).toBe('14.2');
        expect(result.deviceType).toBe('Desktop');
        expect(result.language).toBe('en-US');
        expect(result.country).toBe('ID');
    });

    test('should use Vercel country header as fallback', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            vercelIpCountry: 'US',
        });
        expect(result.country).toBe('US');
    });

    test('should prefer CF country over Vercel', () => {
        const result = extractClientInfo({
            userAgent: 'Mozilla/5.0',
            cfIpCountry: 'SG',
            vercelIpCountry: 'US',
        });
        expect(result.country).toBe('SG');
    });

    test('should handle missing headers gracefully', () => {
        const result = extractClientInfo({});
        expect(result.browser).toBeNull();
        expect(result.os).toBeNull();
        expect(result.language).toBeNull();
        expect(result.country).toBeNull();
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
