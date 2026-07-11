import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiContextPreview } from './AiContextPreview';

describe('AiContextPreview', () => {
    it('shows the complete attached SQL and its request context', () => {
        render(
            <AiContextPreview
                content={'SELECT event_date, count()\nFROM events\nGROUP BY event_date'}
                label="Attached query log SQL"
                metadata={['Database · analytics', 'Query ID · query-123']}
                note="Review before submitting."
            />,
        );

        expect(screen.getByText('Attached query log SQL')).toBeTruthy();
        expect(screen.getByText(/SELECT event_date, count\(\)/)).toBeTruthy();
        expect(screen.getByText('Database · analytics')).toBeTruthy();
        expect(screen.getByText('Query ID · query-123')).toBeTruthy();
        expect(screen.getByText('Review before submitting.')).toBeTruthy();
    });
});
