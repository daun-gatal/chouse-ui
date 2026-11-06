# components/ui

## Overview
shadcn/ui primitives (style `new-york`, configured in `/components.json`) built on Radix UI and Tailwind, plus a few app-specific additions (`data-table`, `multi-step-loader`). One component family per file, named exports, styled with `cn` from `src/lib/utils.ts`.

## Interface
- Overlays: `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `popover.tsx`, `tooltip.tsx` (`Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`), `dropdown-menu.tsx`, `context-menu.tsx`, `select.tsx`, `command.tsx` [dialog.tsx:DialogContent], [tooltip.tsx:TooltipContent]
- Form controls: `button.tsx` (`Button`, `buttonVariants`), `input.tsx` (`Input`), `textarea.tsx` (`Textarea`), `checkbox.tsx` (`Checkbox`), `radio-group.tsx` (`RadioGroup`, `RadioGroupItem`), `switch.tsx` (`Switch`), `label.tsx` (`Label`), `form.tsx` (react-hook-form bindings), `calendar.tsx` (`Calendar`) [button.tsx:buttonVariants]
- Layout and display: `card.tsx` (`Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription`, `CardContent`), `tabs.tsx`, `accordion.tsx`, `collapsible.tsx`, `resizable.tsx` (`ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`), `scroll-area.tsx`, `separator.tsx`, `table.tsx`, `badge.tsx`, `alert.tsx`, `progress.tsx`, `skeleton.tsx` [card.tsx:Card], [resizable.tsx:ResizablePanelGroup]
- `data-table.tsx` - `DataTable`, a TanStack Table wrapper [data-table.tsx:DataTable]
- `multi-step-loader.tsx` - `MultiStepLoader` (framer-motion) [multi-step-loader.tsx:MultiStepLoader]
- `sonner.tsx` - `Toaster` for `toast()` notifications [sonner.tsx:Toaster]

## Invariants
- Floating primitives (`dialog`, `alert-dialog`, `sheet`, `popover`, `tooltip`, `select`, `dropdown-menu`, `context-menu`) take their z-index from `useLayerProps` / `useLayerStyle` in `src/lib/layers.ts`, so they stack correctly with the dock, review screen, and Chobi; do not hard-code z-index here [dialog.tsx:DialogContent], [../../lib/layers.ts:LAYERS].
- `dialog` and `sheet` register with `useOnboardingSurfaceDismiss` so the onboarding tour can close them [dialog.tsx:DialogContent], [sheet.tsx:SheetContent].

## Side Effects
- DOM rendering and portals only, except `MultiStepLoader`, which advances its steps with a `setTimeout` (every `duration` ms) while `loading` is true [multi-step-loader.tsx:MultiStepLoader].

## Verification
- Run: `bunx vitest run src/components/ui`
