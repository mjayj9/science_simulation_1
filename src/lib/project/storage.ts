import { exportProject, importProject } from "./serialization";
import { validateProject, type ProjectV3 } from "./schema";

export const PROJECT_AUTOSAVE_KEY = "solar-simulator:project:v3";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function requireStorage(storage?: StorageLike | null): StorageLike {
  const selected = storage ?? browserStorage();
  if (!selected) throw new Error("이 환경에서는 브라우저 자동 저장소를 사용할 수 없습니다.");
  return selected;
}

export function saveProject(
  project: ProjectV3,
  options: { storage?: StorageLike | null; key?: string } = {},
): void {
  const document = validateProject(project);
  requireStorage(options.storage).setItem(options.key ?? PROJECT_AUTOSAVE_KEY, exportProject(document, { pretty: false }));
}

export function loadProject(options: { storage?: StorageLike | null; key?: string } = {}): ProjectV3 | null {
  const serialized = requireStorage(options.storage).getItem(options.key ?? PROJECT_AUTOSAVE_KEY);
  return serialized === null ? null : importProject(serialized);
}

export function clearSavedProject(options: { storage?: StorageLike | null; key?: string } = {}): void {
  requireStorage(options.storage).removeItem(options.key ?? PROJECT_AUTOSAVE_KEY);
}

export interface AutosaveAdapter {
  schedule(project: ProjectV3): void;
  flush(): void;
  load(): ProjectV3 | null;
  clear(): void;
  dispose(): void;
  readonly pending: boolean;
}

export function createAutosaveAdapter(options: {
  storage?: StorageLike | null;
  key?: string;
  debounceMs?: number;
  onError?: (error: unknown) => void;
} = {}): AutosaveAdapter {
  const storage = requireStorage(options.storage);
  const key = options.key ?? PROJECT_AUTOSAVE_KEY;
  const debounceMs = options.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: ProjectV3 | undefined;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!queued) return;
    const project = queued;
    queued = undefined;
    try {
      saveProject(project, { storage, key });
    } catch (error) {
      options.onError?.(error);
      if (!options.onError) throw error;
    }
  };

  return {
    schedule(project) {
      queued = validateProject(project);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    flush,
    load: () => loadProject({ storage, key }),
    clear: () => clearSavedProject({ storage, key }),
    dispose() {
      flush();
    },
    get pending() {
      return queued !== undefined;
    },
  };
}
