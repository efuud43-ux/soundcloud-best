import { contextBridge, ipcRenderer } from 'electron';
import type { TrackInfo, TrackUpdateReason } from './types';

contextBridge.exposeInMainWorld('soundcloudAPI', {
    sendTrackUpdate: (data: TrackInfo, reason: TrackUpdateReason) => {
        ipcRenderer.send('soundcloud:track-update', {
            data,
            reason,
        });
    },
    checkLyrics: (artist: string, track: string): Promise<boolean> => {
        return ipcRenderer.invoke('soundcloud:check-lyrics', { artist, track });
    },
    downloadFile: (url: string, filename: string): Promise<{ ok: boolean; reason?: string; path?: string }> => {
        return ipcRenderer.invoke('soundcloud:download-file', { url, filename });
    },
    saveFile: (base64: string, filename: string): Promise<{ ok: boolean; reason?: string; path?: string }> => {
        return ipcRenderer.invoke('soundcloud:save-file', { base64, filename });
    },
    getLyrics: (
        artist: string,
        track: string,
        source?: string,
    ): Promise<{ synced: boolean; lines: { timeMs: number; text: string }[]; pending?: boolean }> => {
        return ipcRenderer.invoke('soundcloud:get-lyrics', { artist, track, source });
    },
    getDesign: (): Promise<boolean> => {
        return ipcRenderer.invoke('soundcloud:get-design');
    },
    setDesign: (enabled: boolean): Promise<boolean> => {
        return ipcRenderer.invoke('soundcloud:set-design', enabled);
    },
});

ipcRenderer.on('lyrics-status-update', (_event, data: { hasLyrics: boolean }) => {
    window.dispatchEvent(new CustomEvent('lyricsStatusUpdate', { detail: data }));
});
