# components/common/form

## Overview
A react-hook-form bound text input that renders the shadcn `FormField` label, control, and validation message.

## Interface
- `InputField` (default export) - props `name`, `rules`, `label`, `placeholder`; must be rendered inside a react-hook-form `FormProvider` [InputField.tsx:InputField]

## Invariants
- Reads the form via `useFormContext()`, so it fails outside a `FormProvider` [InputField.tsx:InputField].

## Side Effects
- None.

## Verification
- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/components/common`
