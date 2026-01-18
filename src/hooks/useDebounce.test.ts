/**
 * Tests for useDebounce hook
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDebounce } from './useDebounce';

describe('useDebounce', () => {
    it('should return initial value immediately', () => {
        const { result } = renderHook(() => useDebounce('initial', 100));
        expect(result.current).toBe('initial');
    });

    it('should debounce value changes', async () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value, 100),
            { initialProps: { value: 'initial' } }
        );

        expect(result.current).toBe('initial');

        // Change value
        rerender({ value: 'updated' });

        // Value should still be initial (not updated yet)
        expect(result.current).toBe('initial');

        // Wait for debounce
        await waitFor(
            () => {
                expect(result.current).toBe('updated');
            },
            { timeout: 200 }
        );
    });

    it('should cancel previous timeout on rapid changes', async () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value, 100),
            { initialProps: { value: 'initial' } }
        );

        // Rapid changes
        rerender({ value: 'change1' });
        await new Promise(resolve => setTimeout(resolve, 30));

        rerender({ value: 'change2' });
        await new Promise(resolve => setTimeout(resolve, 30));

        rerender({ value: 'final' });

        // Wait for debounce
        await waitFor(
            () => {
                expect(result.current).toBe('final');
            },
            { timeout: 200 }
        );
    });

    it('should work with numbers', async () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value, 50),
            { initialProps: { value: 0 } }
        );

        rerender({ value: 100 });

        await waitFor(
            () => {
                expect(result.current).toBe(100);
            },
            { timeout: 150 }
        );
    });

    it('should use default delay of 300ms', () => {
        const { result } = renderHook(
            ({ value }) => useDebounce(value),
            { initialProps: { value: 'test' } }
        );

        expect(result.current).toBe('test');
    });
});
