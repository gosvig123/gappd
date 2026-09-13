# Settings layout prototypes

Question: which settings structure stays clear as the window changes size?
No layout has been selected yet. These are throwaway previews, not production settings.

## Run

From the repository root:

```sh
npm --prefix desktop run prototype:settings
```

Open http://127.0.0.1:5174/?variant=A. Use the bottom arrows or Left/Right keys.

- `A`: category sidebar; categories wrap into navigation buttons in narrow panels.
- `B`: overview; columns collapse into one when space is limited.
- `C`: expandable sections; open only the controls you need.

The width slider sets a maximum, never a minimum. The panel also fits the browser
height, with a scrolling content area. Resize the browser to test short windows.

## Scope

Uses existing Gappd typefaces and charcoal, slate, sky-blue palette. Labels stay
left aligned. Layout and information hierarchy change; colors do not distinguish
variants. Appearance, startup, processing, and connection controls use in-memory
demo state. The state drawer shows all values, and Reset demo restores defaults.
No IPC, storage, OAuth, or provider configuration is called. Installed Codex model
setup and Developer Debug are deliberately not simulated.

The existing renderer URL hosts the preview before the real App mounts because
the normal Electron app requires its native bridge. Without `variant`, startup is
unchanged. Production builds remove the development-only lazy import.

## Evidence

- TypeScript check and renderer build passed.
- Desktop tests: 225 passed.
- Browser container checks: A, B, C at 320, 600, and 1120 px; no horizontal overflow.
- Wide A and C reviewed in screenshots.
- Separate viewport-emulation check did not finish; short-window and full mobile
  viewport behavior still need manual review.

Keep these previews on `prototype/responsive-settings`. Once a design is selected,
implement that design in real settings and leave the alternatives on this branch.
