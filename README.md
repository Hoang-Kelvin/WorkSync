# WorkSync

A cross-platform desktop app for managing tasks and assigning them within a
team. Targets Windows and macOS first, then Linux.

> **Status:** base project. The app shell, build pipeline and IPC pattern are
> in place; task features are not implemented yet.

## Tech stack

- [Electron](https://www.electronjs.org/) for the desktop shell
- [Electron Forge](https://www.electronforge.io/) + [Vite](https://vite.dev/) for building and packaging
- [React](https://react.dev/) + TypeScript for the UI
- [oxlint](https://oxc.rs/docs/guide/usage/linter) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) for linting and formatting

## Getting started

Requires Node.js 22.13 or newer.

```bash
npm install
npm start
```

`npm start` runs the app in development mode with hot reload for the UI.

## Scripts

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm start`         | Run the app in development mode                      |
| `npm run package`   | Build an unpacked app for the current OS into `out/` |
| `npm run make`      | Build installers/distributables for the current OS   |
| `npm run typecheck` | Type-check the whole project                         |
| `npm run lint`      | Run oxlint and check formatting                      |
| `npm run lint:fix`  | Auto-fix lint issues and format the code             |

Run `npm run make` on each target OS: Windows produces a Squirrel installer,
macOS a zip, and Linux `.deb` and `.rpm` packages (which need `dpkg`,
`fakeroot` and `rpm` installed).

## Project structure

```
src/
  main/       Electron main process (windows, app lifecycle, IPC handlers)
  preload/    Preload script: the only bridge between main and renderer
  renderer/   React UI (runs as sandboxed web content)
  shared/     Types and constants used by more than one process
forge.config.mts        Packaging, makers and Electron fuses
vite.*.config.mts       Vite config for the main, preload and renderer builds
```

## Adding a main-process feature

The renderer has no Node.js access. To expose a new capability:

1. Add a channel name and the types to `src/shared/ipc.ts` (and a method on `WorkSyncApi`).
2. Implement the handler in `src/main/ipc.ts`.
3. Expose the method in `src/preload/preload.ts`.
4. Call it from React as `window.worksync.<method>()`.

## Security defaults

- `contextIsolation` and `sandbox` are on and `nodeIntegration` is off.
- The preload script exposes a narrow typed API, not `ipcRenderer`.
- Production builds ship a strict Content-Security-Policy (see `vite.renderer.config.mts`).
- Electron fuses disable `RunAsNode` and the Node CLI/inspect flags in packaged apps.

## Not set up yet

- Code signing and notarization (required to distribute on macOS and to avoid
  SmartScreen warnings on Windows). See the note in `forge.config.mts`.
- Auto-update, an app icon, and CI.
- Tasks, users and assignment, which also need a shared backend.

## License

Apache-2.0. See [LICENSE](LICENSE).
