import { readTodoAsset, saveTodoAsset } from "./todoIpc";

type PermissionMode = "read" | "readwrite";

interface FileSystemPermissionDescriptor {
  mode?: PermissionMode;
}

interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read file failed"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(fileName: string, dataBase64: string, mimeType: string): File {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType || "application/octet-stream" });
}

class TodoAssetWritableFileStream {
  private chunks: Blob[] = [];

  constructor(private readonly fileName: string) {}

  async write(data: Blob | BufferSource | string): Promise<void> {
    if (data instanceof Blob) {
      this.chunks.push(data);
      return;
    }
    this.chunks.push(new Blob([data]));
  }

  async close(): Promise<void> {
    const blob = new Blob(this.chunks);
    const file = new File([blob], this.fileName, {
      type: blob.type || "application/octet-stream",
    });
    await saveTodoAsset(this.fileName, await fileToDataUrl(file));
    this.chunks = [];
  }
}

class TodoAssetFileHandle {
  readonly kind = "file";

  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    const asset = await readTodoAsset(this.name);
    return dataUrlToFile(asset.fileName, asset.dataBase64, asset.mimeType);
  }

  async createWritable(
    _options?: FileSystemCreateWritableOptions,
  ): Promise<TodoAssetWritableFileStream> {
    return new TodoAssetWritableFileStream(this.name);
  }
}

class TodoAssetDirectoryHandle {
  readonly kind = "directory";
  readonly name = "todo-assets";

  async getFileHandle(name: string, _options?: { create?: boolean }) {
    return new TodoAssetFileHandle(name);
  }

  async queryPermission(_descriptor?: FileSystemPermissionDescriptor) {
    return "granted" as PermissionState;
  }

  async requestPermission(_descriptor?: FileSystemPermissionDescriptor) {
    return "granted" as PermissionState;
  }
}

export function createTodoAssetDirectoryHandle(): FileSystemDirectoryHandle {
  return new TodoAssetDirectoryHandle() as unknown as FileSystemDirectoryHandle;
}

export function ensureTodoAssetDirectoryPickerFallback() {
  if ("showDirectoryPicker" in window) return;
  Object.defineProperty(window, "showDirectoryPicker", {
    configurable: true,
    value: async () => createTodoAssetDirectoryHandle(),
  });
}
