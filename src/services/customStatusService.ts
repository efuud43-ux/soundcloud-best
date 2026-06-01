import type ElectronStore = require('electron-store');
import fs = require('fs');
import path = require('path');
import os = require('os');

export class CustomStatusService {
    private enabled: boolean = false;
    private lastStatus: string = '';
    private statusFile: string;

    constructor(store: ElectronStore) {
        this.enabled = store.get('displayMode', 'rpc') === 'custom';
        const appData = process.env.APPDATA || os.homedir();
        this.statusFile = path.join(appData, '.soundcloud-status.json');
        console.log('[CustomStatus] Initialized, file:', this.statusFile);
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        console.log('[CustomStatus] setEnabled:', enabled);
        if (!enabled) {
            this.clearStatus();
        }
    }

    public setToken(_token: string): void {}

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async setStatus(text: string): Promise<boolean> {
        if (!this.enabled) {
            console.log('[CustomStatus] Service disabled, not setting status');
            return false;
        }
        if (text === this.lastStatus) {
            console.log('[CustomStatus] Status unchanged, skipping');
            return true;
        }

        console.log('[CustomStatus] Writing status:', text, 'to file:', this.statusFile);

        try {
            const statusData = { text, timestamp: Date.now() };
            fs.writeFileSync(this.statusFile, JSON.stringify(statusData, null, 2));
            this.lastStatus = text;
            console.log('[CustomStatus] Successfully wrote status file');
            return true;
        } catch (error) {
            console.error('[CustomStatus] Failed to write status:', error);
            return false;
        }
    }

    public async clearStatus(): Promise<boolean> {
        try {
            fs.writeFileSync(this.statusFile, JSON.stringify({ text: null, timestamp: Date.now() }));
            this.lastStatus = '';
            return true;
        } catch (error) {
            console.error('[CustomStatus] Failed to clear status:', error);
            return false;
        }
    }
}
