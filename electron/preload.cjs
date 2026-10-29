const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', Object.freeze({
  session: () => ipcRenderer.invoke('desk:session'),
  settings: () => ipcRenderer.invoke('desk:settings'),
  saveSettings: input => ipcRenderer.invoke('desk:saveSettings', input),
  importNote: projectId => ipcRenderer.invoke('desk:importNote', projectId),
  exportNote: noteId => ipcRenderer.invoke('desk:exportNote', noteId),
  openSource: url => ipcRenderer.invoke('desk:openSource', url),
  pickDirectory: () => ipcRenderer.invoke('desk:pickDirectory'),
  listWorkspace: projectId => ipcRenderer.invoke('desk:listWorkspace', projectId),
  readWorkspaceFile: (projectId, path) => ipcRenderer.invoke('desk:readWorkspaceFile', projectId, path),
  readWorkspaceBinary: (projectId, path) => ipcRenderer.invoke('desk:readWorkspaceBinary', projectId, path),
  saveWorkspaceFile: (projectId, path, text) => ipcRenderer.invoke('desk:saveWorkspaceFile', projectId, path, text)
}));
