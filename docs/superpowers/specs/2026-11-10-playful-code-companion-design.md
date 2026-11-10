# Playful Code Companion Design

**Intent:** Make the Breadcrumbs panel feel visibly responsive and inviting while keeping it recognizably native to VS Code and Cursor.

## Approach

Use Anime.js for compact, event-driven motion inside the existing webview. The current-line card, trail entries, provider connection state, empty state, and explanation status will receive small, purposeful transitions. Motion is decorative feedback only: it must never suggest that an explanation, permission, or provider call succeeded before it actually has.

## Constraints

- Preserve the existing provider, privacy, storage, and trail behavior.
- Respect `prefers-reduced-motion`; reduced-motion users receive static state changes.
- Keep the existing VS Code theme-variable visual language and compact panel layout.
- Do not add external network requests, imagery, or new source-context collection.
- Cover animation wiring and reduced-motion behavior with tests where practical, then rehearse the visible panel in an Extension Development Host.

## Chosen Direction

Playful code companion: animated trail markers, an expressive first-run state, tactile current-line changes, and clear loading/ready/error feedback.
