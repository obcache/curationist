"use strict";

// electron/preload.ts
var import_electron = require("electron");
var api = {
  bootstrap: () => import_electron.ipcRenderer.invoke("bootstrap"),
  lintPreset: (content) => import_electron.ipcRenderer.invoke("lint", content),
  importPresets: (folder) => import_electron.ipcRenderer.invoke("import-presets", folder),
  readPreset: (id) => import_electron.ipcRenderer.invoke("read-preset", id),
  saveDocument: (doc, saveAs) => import_electron.ipcRenderer.invoke("save-document", doc, saveAs),
  persistWorkspace: (workspace) => import_electron.ipcRenderer.invoke("persist-workspace", workspace),
  chooseStorage: () => import_electron.ipcRenderer.invoke("choose-storage"),
  updateSettings: (settings) => import_electron.ipcRenderer.invoke("update-settings", settings),
  savePlaylist: (playlist) => import_electron.ipcRenderer.invoke("save-playlist", playlist),
  addPresetToPlaylist: (playlistId, presetId) => import_electron.ipcRenderer.invoke("add-preset-to-playlist", playlistId, presetId),
  createPlaylist: (name) => import_electron.ipcRenderer.invoke("create-playlist", name),
  importPlaylist: () => import_electron.ipcRenderer.invoke("import-playlist"),
  exportPlaylist: (id) => import_electron.ipcRenderer.invoke("export-playlist", id),
  exportWorkspace: (workspace) => import_electron.ipcRenderer.invoke("export-workspace", workspace),
  importWorkspace: () => import_electron.ipcRenderer.invoke("import-workspace"),
  windowControl: (action) => import_electron.ipcRenderer.send("window-control", action),
  onClosing: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("closing", listener);
    return () => import_electron.ipcRenderer.removeListener("closing", listener);
  }
};
import_electron.contextBridge.exposeInMainWorld("milkLab", api);
