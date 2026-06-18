
![ado](https://socialify.git.ci/965962591/ado/image?description=1&font=JetBrains+Mono&language=1&name=1&pattern=Plus&stargazers=1&theme=Auto)


![0](assets/image_2026-06-18_14-49-59.jpg) 

![1](assets/image_2026-06-18_14-58-59.jpg) 

![2](assets/image_2026-06-18_15-01-17.jpg) 
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



Custom fonts can be placed in:

```text
resource/fonts/
```

