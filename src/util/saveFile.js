// src/util/jsonFile.js

export async function loadJson(path, defaultValue = null) {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.json();
    }
  } catch (e) {
    console.log(`Could not read ${path}, using default value.`);
  }
  return defaultValue;
}

export async function saveJson(path, data, { log = true } = {}) {
  await Bun.write(path, JSON.stringify(data, null, 2));
  if (log) {
    console.log(`Saved to ${path}`);
  }
}