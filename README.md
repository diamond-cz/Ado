# Ado

Standalone Tauri + React todo app extracted from `aebox_rust`.

## Development

```bash
npm install
npm run tauri dev
```

Frontend-only build:

```bash
npm run build
```

Tauri build:

```bash
npm run tauri build
```

## Data

Runtime data is stored under the resolved base directory:

- `app_cache/todo/todos.sqlite`
- `app_cache/todo/settings.json`
- `app_cache/todo/backups/`
- `app_cache/todo/assets/`

Set `AEBOX_TODO_BASE` to override the data root. `AEBOX_BASE` is kept as a compatibility fallback.

Custom fonts can be placed in:

```text
resource/fonts/
```

The app creates that directory on demand.
