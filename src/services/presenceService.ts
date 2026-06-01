import type ElectronStore = require('electron-store');
import { ActivityType } from 'discord-api-types/v10';
import { Client as DiscordClient, SetActivity } from '@xhayper/discord-rpc';
import { TranslationService } from './translationService';
import { LyricsService } from './lyricsService';
import { LyricsDisplayService } from './lyricsDisplayService';
import { CustomStatusService } from './customStatusService';
import { normalizeTrackInfo } from '../utils/trackParser';
import type { TrackInfo } from '../types';

export interface Info {
    rpc: DiscordClient;
    ready: boolean;
    autoReconnect: boolean;
}

export interface CombinedDisplaySettings {
    mode: 'rpc' | 'status' | 'both';
    rpcLines: number;
    statusLines: number;
}

export class PresenceService {
    private store: ElectronStore;
    private info: Info;
    private displayWhenIdling: boolean;
    private displaySCSmallIcon: boolean;
    private displayButtons: boolean;
    private displayLyrics: boolean;
    private statusDisplayType: number;
    private translationService: TranslationService;
    private lyricsService: LyricsService;
    private lyricsDisplayService: LyricsDisplayService;
    private trackStartTimestamp: number = 0;
    private lastTrackUrl: string = '';
    private lyricsUpdateInterval: NodeJS.Timeout | null = null;
    private rpcLyricsMode: string = 'line';
    private lyricsSpeedMultiplier: number = 1.0;
    private autoDetectSpeed: boolean = true;
    private currentAutoSpeed: number = 1.0;
    private karaokeCustomText: string = '';
    private karaokeRevealMode: string = 'word';
    private karaokeCustomTransition: string = 'instant';
    private lastRpcUpdate: number = 0;
    private lastStatusUpdate: number = 0;
    private customStatusService: CustomStatusService;
    private displayMode: string = 'rpc';
    private combinedSettings: CombinedDisplaySettings;
    private currentLyricsBuffer: string[] = [];
    private rpcQueue: (SetActivity & { name?: string; statusDisplayType?: number })[] = [];
    private statusQueue: string[] = [];
    private rpcQueueInFlight: boolean = false;
    private statusQueueInFlight: boolean = false;
    private lastLyricsTransport: 'rpc' | 'status' | null = null;
    private rpcReconnectPromise: Promise<boolean> | null = null;
    private rpcRetryAfter: number = 0;
    private lastRpcRecoveryLog: number = 0;

    constructor(store: ElectronStore, translationService: TranslationService) {
        this.store = store;
        this.displayWhenIdling = store.get('displayWhenIdling', false) as boolean;
        this.displaySCSmallIcon = store.get('displaySCSmallIcon', false) as boolean;
        this.displayButtons = store.get('displayButtons', false) as boolean;
        this.displayLyrics = store.get('displayLyrics', true) as boolean;
        this.rpcLyricsMode = store.get('rpcLyricsMode', 'line') as string;
        this.lyricsSpeedMultiplier = store.get('lyricsSpeedMultiplier', 1.0) as number;
        this.autoDetectSpeed = store.get('autoDetectLyricsSpeed', true) as boolean;
        this.karaokeCustomText = store.get('karaokeCustomText', '') as string;
        this.karaokeRevealMode = store.get('karaokeRevealMode', 'word') as string;
        this.karaokeCustomTransition = store.get('karaokeCustomTransition', 'instant') as string;
        this.translationService = translationService;
        this.lyricsService = new LyricsService();
        this.lyricsService.setUsePlainLyrics(store.get('usePlainLyrics', false) as boolean);
        this.statusDisplayType = (store.get('statusDisplayType') as number) ?? 1;
        this.customStatusService = new CustomStatusService(store);
        this.displayMode = store.get('displayMode', 'rpc') as string;
        this.customStatusService.setEnabled(this.displayMode === 'custom' || this.displayMode === 'combined');

        this.combinedSettings = {
            mode: store.get('combinedDisplayMode', 'both') as 'rpc' | 'status' | 'both',
            rpcLines: store.get('rpcLinesCount', 2) as number,
            statusLines: store.get('statusLinesCount', 1) as number,
        };

        this.lyricsDisplayService = new LyricsDisplayService({
            mode: this.rpcLyricsMode as 'line' | 'multiline' | 'karaoke' | 'karaoke_custom',
            karaokeCustomText: this.karaokeCustomText,
            karaokeRevealMode: this.karaokeRevealMode as 'word' | 'char',
            karaokeCustomTransition: this.karaokeCustomTransition as 'instant' | 'char',
        });

        this.info = {
            rpc: new DiscordClient({
                clientId: '1090770350251458592',
            }),
            ready: false,
            autoReconnect: true,
        };

        this.info.rpc.on('ready', () => {
            this.info.ready = true;
            this.rpcRetryAfter = 0;
        });

        this.info.rpc.on('disconnected', () => {
            this.info.ready = false;
        });

        void this.ensureRpcConnection(true);
    }

    public async updatePresence(trackInfo: TrackInfo): Promise<void> {
        try {
            const lyricsToCustomStatus =
                (this.displayMode === 'custom' ||
                    (this.displayMode === 'combined' &&
                        (this.combinedSettings.mode === 'status' || this.combinedSettings.mode === 'both'))) &&
                this.customStatusService.isEnabled();
            console.log(
                '[PresenceService] displayMode:',
                this.displayMode,
                'lyricsToCustomStatus:',
                lyricsToCustomStatus,
            );

            if (!this.store.get('discordRichPresence')) {
                this.clearActivity();
                return;
            }

            if (trackInfo.isPlaying) {
                if (!trackInfo.title || !trackInfo.author) {
                    console.log('Incomplete track info:', trackInfo);
                    return;
                }

                const normalizedTrack = normalizeTrackInfo(
                    trackInfo.title,
                    trackInfo.author,
                    this.store.get('trackParserEnabled', true) as boolean,
                );

                const currentTrack = {
                    author: normalizedTrack.artist,
                    title: normalizedTrack.track,
                    url: trackInfo.url,
                };

                const [elapsedTime, totalTime] = [trackInfo.elapsed, trackInfo.duration];
                const artworkUrl = trackInfo.artwork;

                const parseTimeToMs = (time: string): number => {
                    if (!time) return 0;
                    const isNegative = time.trim().startsWith('-');
                    const raw = isNegative ? time.trim().slice(1) : time.trim();
                    const parts = raw.split(':').map((p) => Number(p));

                    let seconds = 0;
                    for (const part of parts) {
                        seconds = seconds * 60 + (isNaN(part) ? 0 : part);
                    }
                    const ms = seconds * 1000;
                    return isNegative ? -ms : ms;
                };

                const elapsedMilliseconds = Math.max(0, parseTimeToMs(elapsedTime));
                const parsedTotal = parseTimeToMs(totalTime);
                const totalMilliseconds =
                    parsedTotal < 0
                        ? elapsedMilliseconds + Math.abs(parsedTotal) 
                        : parsedTotal;

                if (totalMilliseconds <= 0) return;

                if (!(await this.ensureRpcConnection())) {
                    return;
                }

                const now = Date.now();

                const expectedStartTime = now - elapsedMilliseconds;

                let forceUpdate = false;
                if (
                    this.lastTrackUrl !== currentTrack.url ||
                    Math.abs(this.trackStartTimestamp - expectedStartTime) > 2000
                ) {
                    this.trackStartTimestamp = expectedStartTime;
                    this.lastTrackUrl = currentTrack.url;
                    this.lyricsDisplayService.resetState();
                    forceUpdate = true;

                    if (
                        this.displayMode === 'custom' ||
                        (this.displayMode === 'combined' &&
                            (this.combinedSettings.mode === 'status' || this.combinedSettings.mode === 'both'))
                    ) {
                        await this.clearCustomStatus();
                    }

                    if (this.autoDetectSpeed) {
                        this.currentAutoSpeed = LyricsService.detectSpeedMultiplier(trackInfo.title);
                    }

                    this.startLyricsTimer(currentTrack, artworkUrl, totalMilliseconds);
                }

                const startTimestamp = this.trackStartTimestamp;
                const endTimestamp = startTimestamp + totalMilliseconds;

                let stateText = `${this.shortenString(currentTrack.author)}${currentTrack.author.length < 2 ? '⠀⠀' : ''}`;
                let detailsText = `${this.shortenString(currentTrack.title)}${currentTrack.title.length < 2 ? '⠀⠀' : ''}`;
                let hasLyricsLine = false;
                let lyricsLineIndex = -1;

                if (this.displayLyrics) {
                    await this.lyricsService.fetchLyrics(currentTrack.author, currentTrack.title);

                    if (!this.lyricsService.isHasLyrics() && this.lyricsService.isHasPlainLyrics()) {
                        this.lyricsService.generateSyncedFromPlain(totalMilliseconds);
                    }

                    console.log(
                        '[Lyrics] Track:',
                        currentTrack.author,
                        '-',
                        currentTrack.title,
                        '| hasLyrics:',
                        this.lyricsService.isHasLyrics(),
                    );

                    if (this.lyricsService.isHasLyrics()) {
                        const effectiveSpeed = this.autoDetectSpeed
                            ? this.currentAutoSpeed
                            : this.lyricsSpeedMultiplier;
                        const realElapsed = (Date.now() - this.trackStartTimestamp) * effectiveSpeed;
                        const idx = this.lyricsService.getLineIndex(realElapsed);
                        const currentLine = this.lyricsService.getLyricAtIndex(idx);
                        const prevLine = this.lyricsService.getLyricAtIndex(idx - 1);
                        const nextLine = this.lyricsService.getLyricAtIndex(idx + 1);
                        console.log(
                            '[Lyrics] idx:',
                            idx,
                            '| elapsed:',
                            Math.round(realElapsed),
                            'ms | line:',
                            currentLine?.text || '(none)',
                        );

                        if (currentLine && currentLine.text) {
                            hasLyricsLine = true;
                            lyricsLineIndex = idx;
                            detailsText = `${currentTrack.author} - ${currentTrack.title}`;
                            if (detailsText.length > 128) {
                                detailsText = detailsText.substring(0, 125) + '...';
                            }

                            stateText = this.lyricsDisplayService.formatLyrics(
                                currentLine,
                                prevLine,
                                nextLine,
                                realElapsed,
                                idx,
                            );
                        }
                    }
                }

                const activity: SetActivity & { name?: string; statusDisplayType?: number } = {
                    type: ActivityType.Listening,
                    name: this.statusDisplayType === 1 ? currentTrack.author : 'SoundCloud',
                    details: detailsText,
                    state: stateText,
                    largeImageKey: artworkUrl.replace('50x50.', '500x500.'),
                    startTimestamp,
                    endTimestamp,
                    smallImageKey: this.displaySCSmallIcon ? 'soundcloud-logo' : '',
                    smallImageText: this.displaySCSmallIcon ? 'SoundCloud' : '',
                    statusDisplayType: this.statusDisplayType,
                    instance: false,
                };

                const lyricsTransport = hasLyricsLine ? this.getLyricsTransport(lyricsLineIndex) : 'rpc';

                if (hasLyricsLine && lyricsTransport === 'rpc') {
                    this.applyLyricsToActivity(activity, stateText, detailsText, stateText);
                }

                if (this.displayButtons && currentTrack.url) {
                    activity.buttons = [
                        {
                            label: `▶️ ${this.translationService.translate('listenOnSoundcloud')}`,
                            url: currentTrack.url,
                        },
                    ];
                }

                if (lyricsToCustomStatus) {
                    await this.syncLyricsTransport(lyricsTransport);

                    if (hasLyricsLine && lyricsTransport === 'status') {
                        if (forceUpdate || !this.lyricsUpdateInterval || !this.lyricsService.isHasLyrics()) {
                            await this.updateCustomStatus(this.sanitizeLyricsText(stateText));
                        }
                        activity.details = `${this.shortenString(currentTrack.title)}${currentTrack.title.length < 2 ? '⠀⠀' : ''}`;
                        activity.state = `${this.shortenString(currentTrack.author)}${currentTrack.author.length < 2 ? '⠀⠀' : ''}`;
                    }
                }

                if (this.lyricsUpdateInterval && this.lyricsService.isHasLyrics()) {

                    if (forceUpdate) {
                        await this.setActivitySafe(activity, true);
                    }

                } else {
                    await this.setActivitySafe(activity, forceUpdate);
                }
            } else {

                this.stopLyricsTimer();
                await this.clearCustomStatus();

                if (this.store.get('discordRichPresence')) {

                    const normalizedTrack = normalizeTrackInfo(
                        trackInfo.title,
                        trackInfo.author,
                        this.store.get('trackParserEnabled', true) as boolean,
                    );

                    const currentTrack = {
                        author: normalizedTrack.artist,
                        title: normalizedTrack.track,
                        url: trackInfo.url,
                    };

                    const artworkUrl = trackInfo.artwork;

                    let detailsText = `${currentTrack.author} - ${currentTrack.title}`;
                    if (detailsText.length > 128) {
                        detailsText = detailsText.substring(0, 125) + '...';
                    }

                    if (currentTrack.title && currentTrack.author) {
                        this.info.rpc.user?.setActivity({
                            type: ActivityType.Listening,
                            name: this.statusDisplayType === 1 ? currentTrack.author : 'SoundCloud',
                            details: detailsText,
                            state: '♪ PAUSED',
                            largeImageKey: artworkUrl ? artworkUrl.replace('50x50.', '500x500.') : 'soundcloud-logo',
                            largeImageText: currentTrack.title,
                            smallImageKey: this.displaySCSmallIcon ? 'soundcloud-logo' : '',
                            smallImageText: this.displaySCSmallIcon ? 'SoundCloud' : '',
                            instance: false,
                            buttons:
                                this.displayButtons && currentTrack.url
                                    ? [
                                          {
                                              label: `▶️ ${this.translationService.translate('listenOnSoundcloud')}`,
                                              url: currentTrack.url,
                                          },
                                      ]
                                    : undefined,
                        });
                        await this.setActivitySafe(
                            {
                                type: ActivityType.Listening,
                                name: this.statusDisplayType === 1 ? currentTrack.author : 'SoundCloud',
                                details: detailsText,
                                state: '♪ PAUSED',
                                largeImageKey: artworkUrl
                                    ? artworkUrl.replace('50x50.', '500x500.')
                                    : 'soundcloud-logo',
                                largeImageText: currentTrack.title,
                                smallImageKey: this.displaySCSmallIcon ? 'soundcloud-logo' : '',
                                smallImageText: this.displaySCSmallIcon ? 'SoundCloud' : '',
                                instance: false,
                                buttons:
                                    this.displayButtons && currentTrack.url
                                        ? [
                                              {
                                                  label: `▶️ ${this.translationService.translate('listenOnSoundcloud')}`,
                                                  url: currentTrack.url,
                                              },
                                          ]
                                        : undefined,
                            },
                            true,
                        );
                        return;
                    }
                }

                if (this.displayWhenIdling && this.store.get('discordRichPresence')) {
                    await this.setActivitySafe(
                        {
                            details: 'Listening to SoundCloud',
                            state: 'Paused',
                            largeImageKey: 'idling',
                            largeImageText: 'Paused',
                            smallImageKey: 'soundcloud-logo',
                            smallImageText: 'SoundCloud',
                            instance: false,
                        },
                        true,
                    );
                } else {
                    this.info.rpc.user?.clearActivity();
                }
            }
        } catch (error) {
            console.error('Error during RPC update:', error);
        }
    }

    public updateDisplaySettings(
        displayWhenIdling: boolean,
        displaySCSmallIcon: boolean,
        displayButtons?: boolean,
        displayLyrics?: boolean,
        rpcLyricsMode?: string,
        lyricsSpeedMultiplier?: number,
    ): void {
        this.displayWhenIdling = displayWhenIdling;
        this.displaySCSmallIcon = displaySCSmallIcon;
        if (displayButtons !== undefined) {
            this.displayButtons = displayButtons;
        }
        if (displayLyrics !== undefined) {
            this.displayLyrics = displayLyrics;
        }
        if (rpcLyricsMode !== undefined) {
            this.rpcLyricsMode = rpcLyricsMode;
            this.lyricsDisplayService.updateConfig({
                mode: rpcLyricsMode as 'line' | 'multiline' | 'karaoke' | 'karaoke_custom',
            });
        }
        if (lyricsSpeedMultiplier !== undefined) {
            this.lyricsSpeedMultiplier = lyricsSpeedMultiplier;
        }
    }

    public setLyricsSpeedMultiplier(multiplier: number): void {
        this.lyricsSpeedMultiplier = Math.max(0.5, Math.min(2.0, multiplier));
    }

    public setAutoDetectSpeed(enabled: boolean): void {
        this.autoDetectSpeed = enabled;
    }

    public setDisplayLyrics(displayLyrics: boolean): void {
        this.displayLyrics = displayLyrics;
        if (!displayLyrics) {
            this.lyricsService.clear();
        }
    }

    public setStatusDisplayType(statusDisplayType: number): void {
        this.statusDisplayType = statusDisplayType;
    }

    public setDiscordToken(token: string): void {
        this.customStatusService.setToken(token);
    }

    public setDisplayMode(mode: string): void {
        console.log('[PresenceService] setDisplayMode called:', mode);
        this.displayMode = mode;
        this.customStatusService.setEnabled(mode === 'custom' || mode === 'combined');

        if (mode === 'combined') {

            this.setCombinedDisplaySettings({ mode: 'both' });
        }
    }

    public setCombinedDisplaySettings(settings: Partial<CombinedDisplaySettings>): void {
        this.combinedSettings = { ...this.combinedSettings, ...settings };
        this.store.set('combinedDisplayMode', this.combinedSettings.mode);
        this.store.set('rpcLinesCount', this.combinedSettings.rpcLines);
        this.store.set('statusLinesCount', this.combinedSettings.statusLines);
        console.log('[PresenceService] Updated combined settings:', this.combinedSettings);
    }

    public getCombinedDisplaySettings(): CombinedDisplaySettings {
        return { ...this.combinedSettings };
    }

    private processRpcQueue(): void {
        if (this.rpcQueueInFlight || this.rpcQueue.length === 0) {
            return;
        }

        this.rpcQueueInFlight = true;

        void (async () => {
            try {
                while (this.rpcQueue.length > 0) {
                    const activityToSend = this.rpcQueue.shift();
                    if (!activityToSend) {
                        continue;
                    }

                    const success = await this.setActivitySafe(activityToSend, true);
                    if (!success) {
                        break;
                    }
                }
            } finally {
                this.rpcQueueInFlight = false;
            }
        })();
    }

    private processStatusQueue(): void {
        if (this.statusQueueInFlight || this.statusQueue.length === 0) {
            return;
        }

        const statusToSend = this.statusQueue.shift() || '';
        const now = Date.now();
        let effectiveInterval = 0;

        const baseInterval = 0; 

        if (!statusToSend) {
            return;

            effectiveInterval = 50; 
        }

        this.statusQueueInFlight = true;

        void this.updateCustomStatus(statusToSend)
            .then(() => {
                this.lastStatusUpdate = Date.now() + baseInterval;
            })
            .catch((error) => {
                console.error('[StatusQueue] Failed to update custom status:', error);
            })
            .finally(() => {
                this.statusQueueInFlight = false;
                if (this.statusQueue.length > 0) {
                    this.processStatusQueue();
                }
            });
        return;

        console.log(
            '[StatusQueue] Processing queue, length:',
            this.statusQueue.length,
            'interval:',
            effectiveInterval,
            'lastUpdate:',
            now - this.lastStatusUpdate,
        );

        if (this.statusQueue.length > 0 && now - this.lastStatusUpdate >= effectiveInterval) {
            const statusToSend = this.statusQueue.shift() || '';
            if (statusToSend) {
                console.log('[StatusQueue] Sending status:', statusToSend);
                this.updateCustomStatus(statusToSend)
                    .then(() => {
                        this.lastStatusUpdate = now;
                        console.log('[StatusQueue] Status sent successfully');
                    })
                    .catch((error) => {
                        console.error('[StatusQueue] Failed to update custom status:', error);

                    });
            }
        }
    }

    private optimizeQueues(): void {
        return;
    }

    private clearQueues(): void {
        this.rpcQueue = [];
        this.statusQueue = [];
        this.currentLyricsBuffer = [];
        this.rpcQueueInFlight = false;
        this.statusQueueInFlight = false;
        this.lastLyricsTransport = null;
    }

    private splitTextForDisplay(text: string, maxLines: number): string[] {
        if (!text || maxLines <= 0) return [];

        const maxCharsPerLine = 128;

        let textLines: string[] = [];
        if (text.includes('\n')) {
            textLines = text.split('\n');
        } else if (text.includes(' | ')) {
            textLines = text.split(' | ');
        } else {
            textLines = [text];
        }

        return textLines
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, maxLines)
            .map((line) => (line.length > maxCharsPerLine ? line.substring(0, maxCharsPerLine - 3) + '...' : line));
    }

    private selectVisibleRpcLines(lines: string[], maxLines: number = 2): string[] {
        const preparedLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);
        if (preparedLines.length <= maxLines) {
            return preparedLines;
        }

        const noteSymbol = String.fromCharCode(9834);
        const currentLineIndex = preparedLines.findIndex((line) => line.startsWith(noteSymbol));

        if (currentLineIndex === -1) {
            return preparedLines.slice(0, maxLines);
        }

        if (maxLines === 1) {
            return [preparedLines[currentLineIndex]];
        }

        const nextLine = preparedLines[currentLineIndex + 1];
        if (nextLine) {
            return [preparedLines[currentLineIndex], nextLine];
        }

        const prevLine = preparedLines[currentLineIndex - 1];
        return [prevLine, preparedLines[currentLineIndex]].filter(Boolean) as string[];
    }

    private applyLyricsToActivity(
        activity: SetActivity & { name?: string; statusDisplayType?: number },
        lyricsText: string,
        fallbackDetails: string,
        fallbackState: string,
        preferredLines?: string[],
    ): void {
        const visibleLines =
            preferredLines && preferredLines.length > 0
                ? this.selectVisibleRpcLines(preferredLines, 2)
                : this.selectVisibleRpcLines(this.splitTextForDisplay(lyricsText, 3), 2);

        if (visibleLines.length === 0) {
            activity.details = fallbackDetails;
            activity.state = fallbackState;
            return;
        }

        if (visibleLines.length === 1) {
            activity.details = fallbackDetails;
            activity.state = visibleLines[0];
            return;
        }

        activity.details = visibleLines[0];
        activity.state = visibleLines[1];
    }

    private getLyricsTransport(lineIndex: number): 'rpc' | 'status' {
        if (this.displayMode === 'custom') {
            return 'status';
        }

        if (this.displayMode !== 'combined') {
            return 'rpc';
        }

        if (this.combinedSettings.mode === 'status') {
            return 'status';
        }

        if (this.combinedSettings.mode === 'rpc') {
            return 'rpc';
        }

        const statusLines = Math.max(1, this.combinedSettings.statusLines);
        const rpcLines = Math.max(1, this.combinedSettings.rpcLines);
        const cycleLength = statusLines + rpcLines;
        const cyclePosition = ((Math.max(0, lineIndex) % cycleLength) + cycleLength) % cycleLength;

        return cyclePosition < statusLines ? 'status' : 'rpc';
    }

    private sanitizeLyricsText(text: string): string {
        return text.replace(/^[^\p{L}\p{N}]+\s*/u, '').trim();
    }

    private async syncLyricsTransport(target: 'rpc' | 'status'): Promise<void> {
        if (
            this.displayMode === 'combined' &&
            this.combinedSettings.mode === 'both' &&
            target === 'rpc' &&
            this.lastLyricsTransport === 'status'
        ) {
            this.statusQueue = [];
            await this.clearCustomStatus();
        }

        this.lastLyricsTransport = target;
    }

    private async updateCombinedDisplay(lyricsText: string): Promise<void> {
        this.currentLyricsBuffer = this.selectVisibleRpcLines(this.splitTextForDisplay(lyricsText, 3), 2);
    }

    private getRpcErrorDetails(error: unknown): { code?: number; message: string } {
        const code =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof (error as { code?: unknown }).code === 'number'
                ? (error as { code: number }).code
                : undefined;

        if (error instanceof Error) {
            return { code, message: error.message };
        }

        return { code, message: String(error) };
    }

    private isRpcSessionError(error: unknown): boolean {
        const { code, message } = this.getRpcErrorDetails(error);
        const normalizedMessage = message.toLowerCase();

        return (
            !this.info.rpc.isConnected ||
            normalizedMessage.includes('user logout') ||
            normalizedMessage.includes('connection ended') ||
            normalizedMessage.includes('could not connect') ||
            normalizedMessage.includes('connection timed out') ||
            normalizedMessage.includes('closed by discord') ||
            code === 1000
        );
    }

    private logRpcRecovery(message: string): void {
        const now = Date.now();
        if (now - this.lastRpcRecoveryLog < 5000) {
            return;
        }

        this.lastRpcRecoveryLog = now;
        console.warn(message);
    }

    private markRpcUnavailable(error?: unknown): void {
        const { message } = this.getRpcErrorDetails(error);
        this.info.ready = false;
        this.rpcRetryAfter = Date.now() + 5000;
        this.rpcQueue = [];
        this.rpcQueueInFlight = false;
        this.logRpcRecovery(`[PresenceService] Discord RPC unavailable: ${message}`);
        void this.info.rpc.destroy().catch(() => undefined);
    }

    private async ensureRpcConnection(force: boolean = false): Promise<boolean> {
        if (!this.info.autoReconnect) {
            return this.info.rpc.isConnected && this.info.ready;
        }

        if (!force && Date.now() < this.rpcRetryAfter) {
            return false;
        }

        if (this.info.rpc.isConnected && this.info.ready) {
            return true;
        }

        if (this.rpcReconnectPromise) {
            return this.rpcReconnectPromise;
        }

        this.rpcReconnectPromise = (async () => {
            try {
                if (this.info.rpc.isConnected) {
                    await this.info.rpc.destroy().catch(() => undefined);
                }

                await this.info.rpc.login();
                this.info.ready = true;
                this.rpcRetryAfter = 0;
                return true;
            } catch (error) {
                console.error('Failed to login to Discord RPC:', error);
                this.markRpcUnavailable(error);
                return false;
            } finally {
                this.rpcReconnectPromise = null;
            }
        })();

        return this.rpcReconnectPromise;
    }

    public async updateCustomStatus(text: string): Promise<void> {
        console.log(
            '[PresenceService] updateCustomStatus called, displayMode:',
            this.displayMode,
            'isEnabled:',
            this.customStatusService.isEnabled(),
        );
        console.log('[PresenceService] combinedSettings.mode:', this.combinedSettings.mode);

        const shouldSendStatus =
            (this.displayMode === 'custom' ||
                (this.displayMode === 'combined' &&
                    (this.combinedSettings.mode === 'status' || this.combinedSettings.mode === 'both'))) &&
            this.customStatusService.isEnabled();

        if (shouldSendStatus) {
            console.log('[PresenceService] Sending custom status:', text);
            await this.customStatusService.setStatus(text);
        }
    }

    public async clearCustomStatus(): Promise<void> {
        if (this.customStatusService.isEnabled()) {
            await this.customStatusService.clearStatus();
        }
    }

    public async reconnect(): Promise<void> {
        await this.ensureRpcConnection(true);
    }

    public isConnected(): boolean {
        return this.info.rpc.isConnected && this.info.ready;
    }

    public clearActivity(): void {
        this.stopLyricsTimer();
        void this.clearCustomStatus();
        this.info.rpc.user?.clearActivity();
    }

    private startLyricsTimer(
        currentTrack: { author: string; title: string; url: string },
        artworkUrl: string,
        totalMilliseconds: number,
    ): void {
        this.stopLyricsTimer();

        if (!this.displayLyrics) return;

        let lastQueuedLineIdx = -1;
        let lastQueuedKaraokeState = '';

        let lastQueuedRawLineText: string | null = null;

        let karaokeLastSeenLineIdx = -2;
        let karaokeSkipCurrentLine = false;

        let baselineEstablished = false;

        const buildShortState = () =>
            `${this.shortenString(currentTrack.author)}${currentTrack.author.length < 2 ? '  ' : ''}`;
        const buildShortDetails = () =>
            `${this.shortenString(currentTrack.title)}${currentTrack.title.length < 2 ? '  ' : ''}`;
        const buildFullDetails = () => {
            let details = `${currentTrack.author} - ${currentTrack.title}`;
            if (details.length > 128) {
                details = details.substring(0, 125) + '...';
            }
            return details;
        };

        this.clearQueues();

        this.lyricsUpdateInterval = setInterval(
            async () => {
                const lyricsToCustomStatus =
                    (this.displayMode === 'custom' ||
                        (this.displayMode === 'combined' &&
                            (this.combinedSettings.mode === 'status' || this.combinedSettings.mode === 'both'))) &&
                    this.customStatusService.isEnabled();

                if (!this.store.get('discordRichPresence')) return;

                const effectiveSpeed = this.autoDetectSpeed ? this.currentAutoSpeed : this.lyricsSpeedMultiplier;
                const realElapsed = (Date.now() - this.trackStartTimestamp) * effectiveSpeed;

                if (realElapsed > totalMilliseconds * effectiveSpeed + 5000) {
                    this.stopLyricsTimer();
                    return;
                }

                if (!this.lyricsService.isHasLyrics()) {
                    return;
                }

                const queueLyricsActivity = async (
                    stateText: string,
                    hasLine: boolean,
                    lineIndex: number,
                ): Promise<void> => {
                    if (!stateText) {
                        return;
                    }

                    const lyricsTransport = hasLine ? this.getLyricsTransport(lineIndex) : 'rpc';

                    const activity: SetActivity & { name?: string; statusDisplayType?: number } = {
                        type: ActivityType.Listening,
                        name: this.statusDisplayType === 1 ? currentTrack.author : 'SoundCloud',
                        details: hasLine ? buildFullDetails() : buildShortDetails(),
                        state: stateText,
                        largeImageKey: artworkUrl.replace('50x50.', '500x500.'),
                        startTimestamp: this.trackStartTimestamp,
                        endTimestamp: this.trackStartTimestamp + totalMilliseconds,
                        smallImageKey: this.displaySCSmallIcon ? 'soundcloud-logo' : '',
                        smallImageText: this.displaySCSmallIcon ? 'SoundCloud' : '',
                        statusDisplayType: this.statusDisplayType,
                        instance: false,
                    };

                    if (hasLine && lyricsTransport === 'rpc') {
                        this.applyLyricsToActivity(activity, stateText, buildFullDetails(), stateText);
                    }

                    if (this.displayButtons && currentTrack.url) {
                        activity.buttons = [
                            {
                                label: this.translationService.translate('listenOnSoundcloud'),
                                url: currentTrack.url,
                            },
                        ];
                    }

                    if (
                        lyricsToCustomStatus &&
                        hasLine &&
                        lyricsTransport === 'status'
                    ) {
                        await this.syncLyricsTransport(lyricsTransport);
                        this.statusQueue.push(this.sanitizeLyricsText(stateText));
                        this.processStatusQueue();
                        activity.details = buildShortDetails();
                        activity.state = buildShortState();
                    } else if (hasLine) {
                        await this.syncLyricsTransport(lyricsTransport);
                    }

                    this.rpcQueue.push(activity);
                };

                const idx = this.lyricsService.getLineIndex(realElapsed);
                const isKaraoke = this.rpcLyricsMode === 'karaoke' || this.rpcLyricsMode === 'karaoke_custom';

                if (!baselineEstablished) {
                    baselineEstablished = true;
                    if (idx >= 0 && !isKaraoke) {
                        lastQueuedLineIdx = idx - 1;
                    }

                    if (idx >= 0) {
                        const baselineLine = this.lyricsService.getLyricAtIndex(idx);
                        const baselineText = baselineLine ? (baselineLine.text || '').trim() : '';
                        if (baselineText) {
                            lastQueuedRawLineText = baselineText;
                            if (isKaraoke) {
                                karaokeLastSeenLineIdx = idx;
                            }
                        }
                    }
                }

                if (idx >= 0) {
                    if (isKaraoke) {
                        const currentLine = this.lyricsService.getLyricAtIndex(idx);
                        const prevLine = this.lyricsService.getLyricAtIndex(idx - 1);
                        const nextLine = this.lyricsService.getLyricAtIndex(idx + 1);

                        if (idx !== karaokeLastSeenLineIdx) {
                            karaokeLastSeenLineIdx = idx;
                            const rawText = currentLine ? (currentLine.text || '').trim() : '';
                            if (rawText && rawText === lastQueuedRawLineText) {
                                karaokeSkipCurrentLine = true;
                            } else {
                                karaokeSkipCurrentLine = false;
                                if (rawText) {
                                    lastQueuedRawLineText = rawText;
                                }
                            }
                        }

                        if (!karaokeSkipCurrentLine) {
                            const stateText = this.lyricsDisplayService.formatLyrics(
                                currentLine,
                                prevLine,
                                nextLine,
                                realElapsed,
                                idx,
                            );

                            if (stateText && stateText !== lastQueuedKaraokeState) {
                                lastQueuedKaraokeState = stateText;
                                lastQueuedLineIdx = idx;
                                await queueLyricsActivity(stateText, Boolean(currentLine && currentLine.text), idx);
                            }
                        }
                    } else {
                        if (idx < lastQueuedLineIdx) {
                            lastQueuedLineIdx = idx - 1;
                        }

                        if (idx > lastQueuedLineIdx) {
                            const queuedLines = this.lyricsService.getLyricsRange(lastQueuedLineIdx, idx);

                            for (let offset = 0; offset < queuedLines.length; offset += 1) {
                                const lineIndex = lastQueuedLineIdx + offset + 1;
                                const queuedLine = queuedLines[offset];
                                const rawText = (queuedLine.text || '').trim();

                                if (rawText && rawText === lastQueuedRawLineText) {
                                    continue;
                                }
                                if (rawText) {
                                    lastQueuedRawLineText = rawText;
                                }

                                const prevLine = this.lyricsService.getLyricAtIndex(lineIndex - 1);
                                const nextLine = this.lyricsService.getLyricAtIndex(lineIndex + 1);
                                const stateText = this.lyricsDisplayService.formatLyrics(
                                    queuedLine,
                                    prevLine,
                                    nextLine,
                                    Math.max(realElapsed, queuedLine.timeMs),
                                    lineIndex,
                                );

                                await queueLyricsActivity(stateText, true, lineIndex);
                            }

                            lastQueuedLineIdx = idx;
                            lastQueuedKaraokeState = '';
                        }
                    }
                }

                this.processRpcQueue();
                this.processStatusQueue();
                this.optimizeQueues();
            },
            this.rpcLyricsMode === 'karaoke' || this.rpcLyricsMode === 'karaoke_custom' ? 60 : 120,
        );
        return;

        let lastDisplayedLineIdx = -1;
        let lastDisplayedKaraokeState = '';

        let pendingActivity: (SetActivity & { name?: string; statusDisplayType?: number }) | null = null;

        this.clearQueues();

        this.lyricsUpdateInterval = setInterval(
            async () => {
                const lyricsToCustomStatus =
                    (this.displayMode === 'custom' ||
                        (this.displayMode === 'combined' &&
                            (this.combinedSettings.mode === 'status' || this.combinedSettings.mode === 'both'))) &&
                    this.customStatusService.isEnabled();
                if (!this.store.get('discordRichPresence')) return;

                const effectiveSpeed = this.autoDetectSpeed ? this.currentAutoSpeed : this.lyricsSpeedMultiplier;
                const realElapsed = (Date.now() - this.trackStartTimestamp) * effectiveSpeed;

                if (realElapsed > totalMilliseconds * effectiveSpeed + 5000) {
                    this.stopLyricsTimer();
                    return;
                }

                if (!this.lyricsService.isHasLyrics()) {
                    return;
                }

                const idx = this.lyricsService.getLineIndex(realElapsed);
                const currentLine = this.lyricsService.getLyricAtIndex(idx);
                const nextLine = this.lyricsService.getLyricAtIndex(idx + 1);

                let stateText = `${this.shortenString(currentTrack.author)}${currentTrack.author.length < 2 ? '⠀⠀' : ''}`;
                let detailsText = `${this.shortenString(currentTrack.title)}${currentTrack.title.length < 2 ? '⠀⠀' : ''}`;

                if (currentLine && currentLine.text) {
                    detailsText = `${currentTrack.author} - ${currentTrack.title}`;
                    if (detailsText.length > 128) {
                        detailsText = detailsText.substring(0, 125) + '...';
                    }

                    const prevLine = this.lyricsService.getLyricAtIndex(idx - 1);
                    stateText = this.lyricsDisplayService.formatLyrics(
                        currentLine,
                        prevLine,
                        nextLine,
                        realElapsed,
                        idx,
                    );
                }

                const isKaraoke = this.rpcLyricsMode === 'karaoke' || this.rpcLyricsMode === 'karaoke_custom';

                let hasNewContent = false;
                if (isKaraoke) {
                    hasNewContent = stateText !== lastDisplayedKaraokeState;
                } else {
                    hasNewContent = idx !== lastDisplayedLineIdx && idx >= 0;
                }

                if (hasNewContent) {

                    if (isKaraoke) {
                        lastDisplayedKaraokeState = stateText;
                    } else {
                        lastDisplayedLineIdx = idx;
                    }

                    const startTimestamp = this.trackStartTimestamp;
                    const endTimestamp = startTimestamp + totalMilliseconds;

                    if (currentLine && currentLine.text && this.displayMode === 'combined') {

                        await this.updateCombinedDisplay(stateText);
                    }

                    let rpcStateText = stateText;
                    if (this.displayMode === 'combined') {
                        if (
                            (this.combinedSettings.mode === 'both' || this.combinedSettings.mode === 'rpc') &&
                            this.currentLyricsBuffer.length > 0
                        ) {
                            rpcStateText = this.currentLyricsBuffer[0];
                        } else if (this.combinedSettings.mode === 'status') {

                            rpcStateText = stateText;
                        }
                    }

                    pendingActivity = {
                        type: ActivityType.Listening,
                        name: this.statusDisplayType === 1 ? currentTrack.author : 'SoundCloud',
                        details: detailsText,
                        state: rpcStateText,
                        largeImageKey: artworkUrl.replace('50x50.', '500x500.'),
                        startTimestamp,
                        endTimestamp,
                        smallImageKey: this.displaySCSmallIcon ? 'soundcloud-logo' : '',
                        smallImageText: this.displaySCSmallIcon ? 'SoundCloud' : '',
                        statusDisplayType: this.statusDisplayType,
                        instance: false,
                    };

                    if (this.displayButtons && currentTrack.url) {
                        pendingActivity.buttons = [
                            {
                                label: `▶️ ${this.translationService.translate('listenOnSoundcloud')}`,
                                url: currentTrack.url,
                            },
                        ];
                    }

                    if (lyricsToCustomStatus) {

                        if (
                            this.displayMode === 'custom' ||
                            (this.displayMode === 'combined' && this.combinedSettings.mode === 'status')
                        ) {

                            pendingActivity.details = `${this.shortenString(currentTrack.title)}${currentTrack.title.length < 2 ? '⠀⠀' : ''}`;
                            pendingActivity.state = `${this.shortenString(currentTrack.author)}${currentTrack.author.length < 2 ? '⠀⠀' : ''}`;
                        }
                    }

                    this.rpcQueue.push(pendingActivity);

                    if (this.displayMode === 'combined') {

                        if (this.combinedSettings.mode === 'status' || this.combinedSettings.mode === 'both') {

                            this.processStatusQueue();
                        }
                    } else if (lyricsToCustomStatus && currentLine && currentLine.text) {

                        const customText = stateText.startsWith('♪') ? stateText.replace('♪ ', '') : stateText;
                        await this.updateCustomStatus(customText);
                    }
                }

                this.processRpcQueue();

                this.processStatusQueue();

                this.optimizeQueues();
            },
            this.rpcLyricsMode === 'karaoke' || this.rpcLyricsMode === 'karaoke_custom' ? 100 : 250,
        );
    }

    private stopLyricsTimer(): void {
        if (this.lyricsUpdateInterval) {
            clearInterval(this.lyricsUpdateInterval);
            this.lyricsUpdateInterval = null;
        }
        this.clearQueues();
    }

    public setKaraokeCustomText(text: string): void {
        this.karaokeCustomText = text;
        this.lyricsDisplayService.updateConfig({ karaokeCustomText: text });
    }

    public setKaraokeRevealMode(mode: string): void {
        this.karaokeRevealMode = mode;
        this.lyricsDisplayService.updateConfig({ karaokeRevealMode: mode as 'word' | 'char' });
    }

    public setKaraokeCustomTransition(transition: string): void {
        this.karaokeCustomTransition = transition;
        this.lyricsDisplayService.updateConfig({ karaokeCustomTransition: transition as 'instant' | 'char' });
    }

    public setUsePlainLyrics(use: boolean): void {
        this.lyricsService.setUsePlainLyrics(use);
    }

    private shortenString(str: string): string {
        return this.lyricsDisplayService.shortenString(str);
    }

    private async setActivitySafe(activity: any, force: boolean = false): Promise<boolean> {
        const now = Date.now();

        const updateInterval = 0;
        const timeSinceLast = now - this.lastRpcUpdate;

        if (!force && timeSinceLast < updateInterval) {
            return false;
        }

        if (!(await this.ensureRpcConnection())) {
            return false;
        }

        try {
            if (!this.info.rpc.user) {
                this.markRpcUnavailable(new Error('Discord RPC user is unavailable'));
                return false;
            }

            await this.info.rpc.user.setActivity(activity);
            this.lastRpcUpdate = now;
            return true;
        } catch (e) {
            if (this.isRpcSessionError(e)) {
                this.markRpcUnavailable(e);
                return false;
            }

            console.error('Failed to set activity:', e);
            return false;
        }
    }
}
