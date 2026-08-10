import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import { validateProject, type ProjectV3 } from "./schema";

const DATABASE_NAME = "solarform-engineering-lab";
const DATABASE_VERSION = 1;

export interface StoredProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  document: ProjectV3;
}

export interface StoredAssetRecord {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  blob: Blob;
  updatedAt: string;
}

export interface StoredWeatherRecord {
  key: string;
  provider: string;
  retrievedAt: string;
  expiresAt: string;
  payload: unknown;
}

interface SolarformDatabase extends DBSchema {
  projects: {
    key: string;
    value: StoredProjectRecord;
    indexes: { "by-updated-at": string };
  };
  assets: {
    key: string;
    value: StoredAssetRecord;
    indexes: { "by-project": string };
  };
  "weather-cache": {
    key: string;
    value: StoredWeatherRecord;
    indexes: { "by-expiry": string };
  };
}

let databasePromise: Promise<IDBPDatabase<SolarformDatabase>> | undefined;

export function openProjectDatabase(): Promise<IDBPDatabase<SolarformDatabase>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("이 환경에서는 IndexedDB를 사용할 수 없습니다."));
  }
  databasePromise ??= openDB<SolarformDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      const projects = database.createObjectStore("projects", { keyPath: "id" });
      projects.createIndex("by-updated-at", "updatedAt");
      const assets = database.createObjectStore("assets", { keyPath: "id" });
      assets.createIndex("by-project", "projectId");
      const weather = database.createObjectStore("weather-cache", { keyPath: "key" });
      weather.createIndex("by-expiry", "expiresAt");
    },
  });
  return databasePromise;
}

export async function saveProjectIndexed(project: ProjectV3): Promise<void> {
  const document = validateProject(project);
  const database = await openProjectDatabase();
  await database.put("projects", {
    id: document.id,
    name: document.name,
    updatedAt: document.updatedAt,
    document,
  });
}

export async function loadProjectIndexed(id: string): Promise<ProjectV3 | null> {
  const database = await openProjectDatabase();
  const record = await database.get("projects", id);
  return record ? validateProject(record.document) : null;
}

export async function listProjectsIndexed(): Promise<StoredProjectRecord[]> {
  const database = await openProjectDatabase();
  const records = await database.getAllFromIndex("projects", "by-updated-at");
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function deleteProjectIndexed(id: string): Promise<void> {
  const database = await openProjectDatabase();
  const transaction = database.transaction(["projects", "assets"], "readwrite");
  await transaction.objectStore("projects").delete(id);
  const assetKeys = await transaction.objectStore("assets").index("by-project").getAllKeys(id);
  await Promise.all(assetKeys.map((key) => transaction.objectStore("assets").delete(key)));
  await transaction.done;
}

export async function putProjectAsset(record: StoredAssetRecord): Promise<void> {
  if (!record.id || !record.projectId || !record.fileName || !record.sha256) {
    throw new Error("GLB/GLTF 자산의 ID, 프로젝트 ID, 파일명과 SHA-256이 필요합니다.");
  }
  if (!(record.blob instanceof Blob)) throw new TypeError("자산 내용은 Blob이어야 합니다.");
  const database = await openProjectDatabase();
  await database.put("assets", record);
}

export async function getProjectAsset(id: string): Promise<StoredAssetRecord | null> {
  const database = await openProjectDatabase();
  return (await database.get("assets", id)) ?? null;
}

export async function listProjectAssets(projectId: string): Promise<StoredAssetRecord[]> {
  const database = await openProjectDatabase();
  return database.getAllFromIndex("assets", "by-project", projectId);
}

export async function putWeatherCache(record: StoredWeatherRecord): Promise<void> {
  if (!Number.isFinite(Date.parse(record.retrievedAt)) || !Number.isFinite(Date.parse(record.expiresAt))) {
    throw new Error("기상 캐시 시각은 ISO 날짜여야 합니다.");
  }
  const database = await openProjectDatabase();
  await database.put("weather-cache", record);
}

export async function getWeatherCache(key: string, now = new Date()): Promise<StoredWeatherRecord | null> {
  const database = await openProjectDatabase();
  const record = await database.get("weather-cache", key);
  if (!record) return null;
  if (Date.parse(record.expiresAt) <= now.getTime()) {
    await database.delete("weather-cache", key);
    return null;
  }
  return record;
}

export async function pruneExpiredWeatherCache(now = new Date()): Promise<number> {
  const database = await openProjectDatabase();
  const transaction = database.transaction("weather-cache", "readwrite");
  const index = transaction.store.index("by-expiry");
  let cursor = await index.openCursor(IDBKeyRange.upperBound(now.toISOString()));
  let deleted = 0;
  while (cursor) {
    await cursor.delete();
    deleted += 1;
    cursor = await cursor.continue();
  }
  await transaction.done;
  return deleted;
}
