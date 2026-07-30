type: patch

### Fixed
- **Explorer sidebar clipped its own controls** — Radix's scroll area wraps its content in a shrink-to-fit `display: table` element, so a single long query in the History tab stretched the panel to the width of that query and everything past the sidebar edge was clipped: the status filter, the Clear button, and the per-row delete buttons all disappeared, and query text never truncated. The scroll area's content wrapper now uses block layout, so list rows stay at viewport width in every sidebar tab (horizontal scroll areas are unaffected).
- **Explorer sidebar tab strip overflowed** — the five sidebar tabs did not fit at the default sidebar width, pushing Queries out of view. Tab labels now collapse to icons for inactive tabs when the sidebar is narrow, and every tab carries an accessible name and tooltip.
