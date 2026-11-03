# WorkSync

A personal desktop app for a project manager who tracks customer tasks kept in
Excel files written in another language, such as Japanese. It keeps the
manager's own understanding of each task next to the original text, shows the
work visually, and publishes a read-only copy to a shared folder. It runs from
an unzipped folder with no installation and no server. Targets Windows and
macOS first, then Linux.

> **Status:** step 1 of the build plan, the work PC test build. The app opens a
> check screen that confirms it can run from its folder and save data beside
> it. Task features come next.

The specifications and the design mockup are in [docs/](docs/README.md).

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

`npm run make` builds for the OS it runs on. Windows and macOS produce a zip
that runs without installing, and Linux produces `.deb` and `.rpm` packages
(which need `dpkg`, `fakeroot` and `rpm` installed). A Windows zip can also be
built from Linux or macOS with `npx electron-forge make --platform=win32`.

## Getting a Windows build

Every push runs the **Build** workflow on GitHub Actions. It checks lint and
types, then builds on Windows, macOS and Linux. To try the app on a Windows PC:

1. Open the repository's **Actions** tab and the latest **Build** run.
2. Download the **WorkSync-windows** artifact and unzip it.
3. Unzip the `WorkSync-win32-x64-*.zip` inside it into a folder on a local
   drive, such as `D:\Tools`.
4. Run `worksync.exe` in the `WorkSync-win32-x64` folder.

The app keeps its data in a `WorkSync-data` folder beside the app folder, so
replacing the app folder with a new version keeps the data. Builds are not
code signed yet, so Windows SmartScreen may warn the first time: choose
**More info**, then **Run anyway**.

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
- Auto-update and an app icon.
- Task features. See the build plan in
  [06 Technical architecture](docs/specs/06-technical-architecture.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
