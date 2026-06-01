import { LyricLine } from './lyricsService';

export { LyricLine };

export interface KaraokeState {
    lastLineIdx: number;
    lastShowWords: number;
    lastShowChars: number;
    lastWordChangeTime: number;
    showingCustomWord: boolean;
}

export interface KaraokeResult {
    showWords: number;
    showChars: number;
    showCustom: boolean;
    transitionChars: number;
}

export type DisplayMode = 'line' | 'multiline' | 'karaoke' | 'karaoke_custom';
export type RevealMode = 'word' | 'char';
export type TransitionMode = 'instant' | 'char';

export interface LyricsDisplayConfig {
    mode: DisplayMode;
    karaokeCustomText: string;
    karaokeRevealMode: RevealMode;
    karaokeCustomTransition: TransitionMode;
}

const DEFAULT_CONFIG: LyricsDisplayConfig = {
    mode: 'line',
    karaokeCustomText: '',
    karaokeRevealMode: 'word',
    karaokeCustomTransition: 'instant',
};

const MAX_STRING_LENGTH = 128;
const CUSTOM_DISPLAY_TIME_MS = 150;
const CHAR_TRANSITION_TIME_MS = 300;
const MIN_LINE_DURATION_MS = 1000;
const MAX_LINE_DURATION_MS = 8000;
const DEFAULT_LINE_DURATION_MS = 3000;

export class LyricsDisplayService {
    private config: LyricsDisplayConfig;
    private karaokeState: KaraokeState;

    constructor(config?: Partial<LyricsDisplayConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.karaokeState = this.createInitialKaraokeState();
    }

    private createInitialKaraokeState(): KaraokeState {
        return {
            lastLineIdx: -1,
            lastShowWords: 0,
            lastShowChars: 0,
            lastWordChangeTime: 0,
            showingCustomWord: false,
        };
    }

    public resetState(): void {
        this.karaokeState = this.createInitialKaraokeState();
    }

    public updateConfig(config: Partial<LyricsDisplayConfig>): void {
        this.config = { ...this.config, ...config };
    }

    public getConfig(): LyricsDisplayConfig {
        return { ...this.config };
    }

    public getKaraokeState(): KaraokeState {
        return { ...this.karaokeState };
    }

    public shortenString(str: string, maxLength: number = MAX_STRING_LENGTH): string {
        if (!str) return '';
        if (str.length <= maxLength) {
            return str;
        }
        if (maxLength <= 3) {
            return str.substring(0, maxLength);
        }
        return str.substring(0, maxLength - 3) + '...';
    }

    public formatLyrics(
        currentLine: LyricLine | null,
        prevLine: LyricLine | null,
        nextLine: LyricLine | null,
        elapsedMs: number,
        lineIndex: number
    ): string {
        if (!currentLine || !currentLine.text) {
            return '';
        }

        const text = currentLine.text.trim();
        if (!text) return '';

        switch (this.config.mode) {
            case 'multiline':
                return this.formatMultilineMode(
                    prevLine?.text?.trim() || '',
                    text,
                    nextLine?.text?.trim() || ''
                );

            case 'karaoke':
            case 'karaoke_custom':
                return this.formatKaraoke(currentLine, nextLine, elapsedMs, lineIndex);

            case 'line':
            default:
                return this.formatLineMode(text);
        }
    }

    public formatLineMode(text: string): string {
        return this.shortenString(`♪ ${text}`);
    }

    public formatMultilineMode(prev: string, current: string, next: string): string {
        const parts: string[] = [];

        if (prev) {
            parts.push(this.shortenString(prev));
        }

        parts.push(this.shortenString(`♪ ${current}`));

        if (next) {
            parts.push(this.shortenString(next));
        }

        return parts.join('\n');
    }

    private formatKaraoke(
        currentLine: LyricLine,
        nextLine: LyricLine | null,
        elapsedMs: number,
        lineIndex: number
    ): string {
        const result = this.calculateKaraokeProgress(currentLine, nextLine, elapsedMs, lineIndex);
        const formatted = this.buildKaraokeText(currentLine.text, result);
        return this.shortenString(formatted);
    }

    public calculateKaraokeProgress(
        currentLine: LyricLine,
        nextLine: LyricLine | null,
        elapsedMs: number,
        lineIndex: number
    ): KaraokeResult {
        const text = currentLine.text;
        const words = text.split(' ').filter(w => w.length > 0);
        const wordCount = Math.max(1, words.length);
        const totalChars = text.length;

        const lineDuration = this.calculateLineDuration(currentLine, nextLine, wordCount);

        const elapsedInLine = Math.max(0, elapsedMs - currentLine.timeMs);
        const progress = Math.min(1, elapsedInLine / lineDuration);

        let showWords = Math.max(1, Math.ceil(progress * wordCount));
        let showChars = Math.max(1, Math.ceil(progress * totalChars));

        if (lineIndex !== this.karaokeState.lastLineIdx) {
            this.karaokeState.lastLineIdx = lineIndex;
            this.karaokeState.lastShowWords = 0;
            this.karaokeState.lastShowChars = 0;
            this.karaokeState.lastWordChangeTime = Date.now();
            this.karaokeState.showingCustomWord = true;
        }

        const { showCustom, transitionChars } = this.updateKaraokeAnimation(
            showWords,
            showChars,
            words
        );

        return { showWords, showChars, showCustom, transitionChars };
    }

    private calculateLineDuration(
        currentLine: LyricLine,
        nextLine: LyricLine | null,
        wordCount: number
    ): number {
        if (nextLine) {

            const timeToNext = nextLine.timeMs - currentLine.timeMs;
            const buffer = Math.min(200, timeToNext * 0.1);
            return Math.max(MIN_LINE_DURATION_MS, Math.min(MAX_LINE_DURATION_MS, timeToNext - buffer));
        }

        const estimatedDuration = wordCount * 400;
        return Math.max(DEFAULT_LINE_DURATION_MS, Math.min(MAX_LINE_DURATION_MS, estimatedDuration));
    }

    private updateKaraokeAnimation(
        showWords: number,
        showChars: number,
        words: string[]
    ): { showCustom: boolean; transitionChars: number } {
        const isCharMode = this.config.karaokeRevealMode === 'char';
        const now = Date.now();

        if (isCharMode) {
            if (showChars > this.karaokeState.lastShowChars) {
                this.karaokeState.lastWordChangeTime = now;
                this.karaokeState.showingCustomWord = true;
                this.karaokeState.lastShowChars = showChars;
            }
        } else {
            if (showWords > this.karaokeState.lastShowWords) {
                this.karaokeState.lastWordChangeTime = now;
                this.karaokeState.showingCustomWord = true;
                this.karaokeState.lastShowWords = showWords;
            }
        }

        let showCustom = false;
        let transitionChars = 0;

        if (this.karaokeState.showingCustomWord && this.config.mode === 'karaoke_custom') {
            const timeSinceChange = now - this.karaokeState.lastWordChangeTime;

            if (this.config.karaokeCustomTransition === 'char') {
                if (timeSinceChange < CUSTOM_DISPLAY_TIME_MS) {
                    showCustom = true;
                } else if (timeSinceChange < CUSTOM_DISPLAY_TIME_MS + CHAR_TRANSITION_TIME_MS) {
                    const currentWord = isCharMode
                        ? this.getCurrentWordFromChars(showChars, words)
                        : words[showWords - 1] || '';
                    const transitionProgress = (timeSinceChange - CUSTOM_DISPLAY_TIME_MS) / CHAR_TRANSITION_TIME_MS;
                    transitionChars = Math.ceil(transitionProgress * currentWord.length);
                    showCustom = transitionChars < currentWord.length;
                } else {
                    this.karaokeState.showingCustomWord = false;
                }
            } else {

                if (timeSinceChange < CUSTOM_DISPLAY_TIME_MS) {
                    showCustom = true;
                } else {
                    this.karaokeState.showingCustomWord = false;
                }
            }
        }

        return { showCustom, transitionChars };
    }

    private getCurrentWordFromChars(showChars: number, words: string[]): string {
        let charCount = 0;
        for (const word of words) {
            charCount += word.length + 1; 
            if (charCount >= showChars) {
                return word;
            }
        }
        return words[words.length - 1] || '';
    }

    public buildKaraokeText(lineText: string, result: KaraokeResult): string {
        const words = lineText.split(' ').filter(w => w.length > 0);
        const isCharMode = this.config.karaokeRevealMode === 'char';
        const customText = this.config.karaokeCustomText;
        const isCustomMode = this.config.mode === 'karaoke_custom' && customText;

        if (isCustomMode && result.showCustom) {
            return this.buildCustomTextDisplay(lineText, words, result, isCharMode);
        }

        if (isCustomMode && result.transitionChars > 0 && this.config.karaokeCustomTransition === 'char') {
            return this.buildTransitionDisplay(lineText, words, result, isCharMode);
        }

        if (isCharMode) {
            const revealed = lineText.substring(0, result.showChars);
            return `♪ ${revealed}`;
        }

        const revealedWords = words.slice(0, result.showWords).join(' ');
        return `♪ ${revealedWords}`;
    }

    private buildCustomTextDisplay(
        lineText: string,
        words: string[],
        result: KaraokeResult,
        isCharMode: boolean
    ): string {
        const customText = this.config.karaokeCustomText;

        if (isCharMode) {
            const prevText = lineText.substring(0, Math.max(0, result.showChars - 1));
            const lastChar = prevText.length > 0 ? prevText[prevText.length - 1] : '';

            if (lastChar === ' ' || prevText.length === 0) {
                return `♪ ${prevText}${customText}`;
            }

            const lastSpaceIdx = prevText.lastIndexOf(' ');
            if (lastSpaceIdx >= 0) {
                return `♪ ${prevText.substring(0, lastSpaceIdx + 1)}${customText}`;
            }
            return `♪ ${customText}`;
        }

        const prevWords = words.slice(0, Math.max(0, result.showWords - 1)).join(' ');
        return prevWords ? `♪ ${prevWords} ${customText}` : `♪ ${customText}`;
    }

    private buildTransitionDisplay(
        lineText: string,
        words: string[],
        result: KaraokeResult,
        isCharMode: boolean
    ): string {
        const customText = this.config.karaokeCustomText;

        if (isCharMode) {
            const shownText = lineText.substring(0, result.showChars);
            const lastSpaceIdx = shownText.lastIndexOf(' ');
            const currentWord = lastSpaceIdx >= 0 ? shownText.substring(lastSpaceIdx + 1) : shownText;
            const prevText = lastSpaceIdx >= 0 ? shownText.substring(0, lastSpaceIdx + 1) : '';
            const partialWord = currentWord.substring(0, result.transitionChars);
            const customRemainder = customText.substring(Math.min(result.transitionChars, customText.length));
            return `♪ ${prevText}${partialWord}${customRemainder}`;
        }

        const prevWords = words.slice(0, Math.max(0, result.showWords - 1)).join(' ');
        const currentWord = words[result.showWords - 1] || '';
        const partialWord = currentWord.substring(0, result.transitionChars);
        const customRemainder = customText.substring(Math.min(result.transitionChars, customText.length));
        return prevWords ? `♪ ${prevWords} ${partialWord}${customRemainder}` : `♪ ${partialWord}${customRemainder}`;
    }
}
