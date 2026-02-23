import { useState, useEffect } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

interface WindowSize {
    width: number;
    height: number;
    breakpoint: Breakpoint;
}

function getBreakpoint(width: number): Breakpoint {
    if (width <= 640) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
}

/**
 * Returns the current viewport size and a derived breakpoint.
 * Updates are debounced (100ms) to avoid excessive re-renders.
 */
export function useWindowSize(): WindowSize {
    const [size, setSize] = useState<WindowSize>(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        breakpoint: getBreakpoint(window.innerWidth),
    }));

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;

        const handleResize = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const w = window.innerWidth;
                const h = window.innerHeight;
                setSize({ width: w, height: h, breakpoint: getBreakpoint(w) });
            }, 100);
        };

        window.addEventListener('resize', handleResize);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    return size;
}
