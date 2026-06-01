import { net } from 'electron';

export interface LyricLine {
    timeMs: number;
    text: string;
}

export class LyricsService {
    private lyrics: LyricLine[] = [];
    private hasLyrics: boolean = false;
    private lastTrack: string = '';
    private lastArtist: string = '';
    private plainLyrics: string = '';
    private hasPlainLyrics: boolean = false;
    private usePlainLyrics: boolean = false;

    private fetchCounter: number = 0;
    private currentFetchId: number = 0;
    private inFlight: boolean = false;

    private static artistAliases: { [key: string]: string[] } = {
        'dekma': ['вульф', 'wulf', 'wxlf', '2g shoota'],
        'вульф': ['dekma', 'wulf', 'wxlf', '2g shoota'],
        'wxlf': ['dekma', 'вульф', 'wulf', '2g shoota'],
        'wulf': ['dekma', 'вульф', 'wxlf', '2g shoota'],
        '2g shoota': ['dekma', 'вульф', 'wxlf', 'wulf'],
        'shtrihcod': ['штрихкод'],
        'штрихкод': ['shtrihcod'],
        'eyezakk': ['айзак', '2g shoota'],
        'pharaoh': ['фараон', 'glam'],
        'фараон': ['pharaoh', 'glam'],
        'morgenshtern': ['моргенштерн'],
        'моргенштерн': ['morgenshtern'],
        'kizaru': ['кизару'],
        'кизару': ['kizaru'],
        'big baby tape': ['ббт'],
        'ббт': ['big baby tape'],
    };

    private static getArtistAliases(artist: string): string[] {
        const lower = artist.toLowerCase();
        const aliases: string[] = [artist];

        for (const [key, values] of Object.entries(LyricsService.artistAliases)) {
            if (lower.includes(key)) {
                for (const alias of values) {
                    const replaced = artist.toLowerCase().replace(key, alias);
                    if (!aliases.includes(replaced)) {
                        aliases.push(replaced);
                    }
                }
            }
        }

        return aliases;
    }

    public async fetchLyrics(artist: string, track: string, force: boolean = false): Promise<void> {
        const normalizeKey = (s: string) => s.toLowerCase().trim();
        const trackKey = normalizeKey(track);
        const artistKey = normalizeKey(artist);

        if (!force && this.lastTrack === trackKey && this.lastArtist === artistKey) {
            console.log('[LyricsService] Same track, skipping fetch');
            return;
        }

        const fetchId = ++this.fetchCounter;
        this.currentFetchId = fetchId;
        const isStale = () => this.currentFetchId !== fetchId;

        console.log('[LyricsService] Fetching lyrics for:', artist, '-', track, '| fetchId:', fetchId);

        this.lastTrack = trackKey;
        this.lastArtist = artistKey;
        this.lyrics = [];
        this.hasLyrics = false;
        this.plainLyrics = '';
        this.hasPlainLyrics = false;

        try {
            this.inFlight = true;

            const direct = await this.lrclibGetLyrics(artist, track);
            if (isStale()) return;
            if (direct.synced && direct.lines.length > 0) {
                this.lyrics = direct.lines;
                this.hasLyrics = true;
                console.log('[LyricsService] Direct lrclib synced, lines:', this.lyrics.length);
                return;
            }
            if (!direct.synced && direct.lines.length > 0) {
                this.plainLyrics = direct.lines.map((l) => l.text).join('\n');
                this.hasPlainLyrics = true;
                console.log('[LyricsService] Direct lrclib plain, lines:', direct.lines.length);
            }

            const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();

            const levenshtein = (a: string, b: string): number => {
                if (a.length === 0) return b.length;
                if (b.length === 0) return a.length;
                const matrix: number[][] = [];
                for (let i = 0; i <= b.length; i++) matrix[i] = [i];
                for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
                for (let i = 1; i <= b.length; i++) {
                    for (let j = 1; j <= a.length; j++) {
                        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
                        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
                    }
                }
                return matrix[b.length][a.length];
            };

            const wordSimilarity = (a: string, b: string): number => {
                if (a === b) return 1;
                if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
                const maxLen = Math.max(a.length, b.length);
                const dist = levenshtein(a, b);
                return Math.max(0, 1 - dist / maxLen);
            };

            const similarity = (a: string, b: string): number => {
                const na = normalize(a);
                const nb = normalize(b);
                if (na === nb) return 1;
                if (na.includes(nb) || nb.includes(na)) return 0.85;
                const wordsA = na.split(/\s+/).filter(w => w.length > 0);
                const wordsB = nb.split(/\s+/).filter(w => w.length > 0);
                if (wordsA.length === 0 || wordsB.length === 0) return 0;

                let matchedScore = 0;
                const usedB = new Set<number>();
                for (const wordA of wordsA) {
                    let bestMatch = 0;
                    let bestIdx = -1;
                    for (let i = 0; i < wordsB.length; i++) {
                        if (usedB.has(i)) continue;
                        const sim = wordSimilarity(wordA, wordsB[i]);
                        if (sim > bestMatch) {
                            bestMatch = sim;
                            bestIdx = i;
                        }
                    }
                    if (bestIdx >= 0 && bestMatch > 0.7) {
                        usedB.add(bestIdx);
                        matchedScore += bestMatch;
                    }
                }
                return matchedScore / Math.max(wordsA.length, wordsB.length);
            };

            const isRemix = (s: string): boolean => {
                const lower = s.toLowerCase();
                return /\b(remix|rmx|cover|bootleg|flip|vip)\b/i.test(lower);
            };

            const tryFetch = async (queryArtist: string, queryTrack: string, strictArtist: boolean = true, allowPlain: boolean = false): Promise<boolean> => {
                try {
                    if (isStale()) {
                        return false;
                    }

                    if (this.hasLyrics) {
                        return true;
                    }

                    const searchQuery = encodeURIComponent(`${queryArtist} ${queryTrack}`.trim());
                    const searchUrl = `https://lrclib.net/api/search?q=${searchQuery}`;

                    const response = await this.fetchUrl(searchUrl);
                    if (!response) return false;

                    const searchResults = JSON.parse(response);
                    if (!Array.isArray(searchResults) || searchResults.length === 0) return false;

                    const withSynced = searchResults.filter((r: any) => r.syncedLyrics);
                    const withPlain = allowPlain ? searchResults.filter((r: any) => r.plainLyrics && !r.syncedLyrics) : [];

                    if (withSynced.length === 0 && withPlain.length === 0) return false;

                    const candidates = withSynced.length > 0 ? withSynced : withPlain;
                    const isPlainSearch = withSynced.length === 0;

                    let bestMatch: any = null;
                    let bestScore = 0;

                    const normalizedQueryTrack = normalize(queryTrack);
                    const normalizedQueryArtist = normalize(queryArtist);
                    const queryIsRemix = isRemix(queryTrack);
                    const queryArtistWords = normalizedQueryArtist.split(/\s+/).filter(w => w.length > 1);
                    const isShortTrack = normalizedQueryTrack.length < 10 || normalizedQueryTrack.split(/\s+/).length <= 2;
                    const minArtistScore = isShortTrack ? 0.6 : 0.5;

                    for (const result of candidates) {
                        const resultTrack = normalize(result.trackName || '');
                        const resultArtist = normalize(result.artistName || '');

                        if (resultTrack === normalizedQueryTrack) {
                            if (!normalizedQueryArtist || resultArtist === normalizedQueryArtist ||
                                resultArtist.includes(normalizedQueryArtist) || normalizedQueryArtist.includes(resultArtist)) {
                                bestMatch = result;
                                bestScore = 1;
                                break;
                            }
                        }
                    }

                    if (bestMatch && bestScore === 1) {
                        if (isStale()) return false;
                        if (isPlainSearch) {
                            this.plainLyrics = bestMatch.plainLyrics || '';
                            this.hasPlainLyrics = this.plainLyrics.length > 0;
                            return this.hasPlainLyrics;
                        }
                        this.lyrics = this.parseLrc(bestMatch.syncedLyrics);
                        this.hasLyrics = this.lyrics.length > 0;
                        console.log('[LyricsService] Loaded synced lyrics, lines:', this.lyrics.length);
                        this.plainLyrics = '';
                        this.hasPlainLyrics = false;
                        return this.hasLyrics;
                    }

                    bestMatch = null;
                    bestScore = 0;

                    for (const result of candidates) {
                        const resultTrack = normalize(result.trackName || '');
                        const resultArtist = normalize(result.artistName || '');
                        const resultIsRemix = isRemix(result.trackName || '');

                        let artistScore = 0;
                        if (queryArtist) {
                            if (resultArtist === normalizedQueryArtist) {
                                artistScore = 1;
                            } else if (resultArtist.includes(normalizedQueryArtist) || normalizedQueryArtist.includes(resultArtist)) {
                                artistScore = 0.95;
                            } else {
                                const resultArtistWords = resultArtist.split(/\s+/).filter(w => w.length > 1);
                                const commonWords = queryArtistWords.filter(w => resultArtistWords.includes(w));
                                if (commonWords.length > 0) {
                                    artistScore = 0.8 * (commonWords.length / Math.max(queryArtistWords.length, 1));
                                } else {
                                    artistScore = similarity(result.artistName || '', queryArtist);
                                }
                            }
                        } else {
                            artistScore = 0.5;
                        }

                        if (strictArtist && queryArtist && artistScore < minArtistScore) {
                            continue;
                        }

                        let trackScore = 0;
                        if (resultTrack === normalizedQueryTrack) {
                            trackScore = 1;
                        } else if (resultTrack.includes(normalizedQueryTrack)) {
                            const lengthRatio = normalizedQueryTrack.length / resultTrack.length;
                            trackScore = 0.7 + (lengthRatio * 0.25);
                        } else if (normalizedQueryTrack.includes(resultTrack)) {
                            const lengthRatio = resultTrack.length / normalizedQueryTrack.length;
                            trackScore = lengthRatio < 0.5 ? 0.4 : 0.6 + (lengthRatio * 0.2);
                        } else {
                            trackScore = similarity(result.trackName || '', queryTrack);
                        }

                        if (queryIsRemix !== resultIsRemix) {
                            trackScore *= 0.7;
                        }

                        if (!queryIsRemix && resultIsRemix) {
                            trackScore *= 0.5;
                        }

                        const score = queryArtist
                            ? artistScore * 0.4 + trackScore * 0.6
                            : trackScore;

                        if (trackScore < 0.5) continue;

                        if (score > bestScore && artistScore >= minArtistScore) {
                            bestScore = score;
                            bestMatch = result;
                        }
                    }

                    const minScore = isShortTrack ? 0.55 : 0.5;
                    if (!bestMatch || bestScore < minScore) {
                        return false;
                    }

                    if (isPlainSearch) {
                        if (isStale()) return false;
                        this.plainLyrics = bestMatch.plainLyrics || '';
                        this.hasPlainLyrics = this.plainLyrics.length > 0;
                        return this.hasPlainLyrics;
                    }

                    if (isStale()) return false;
                    this.lyrics = this.parseLrc(bestMatch.syncedLyrics);
                    this.hasLyrics = this.lyrics.length > 0;
                    console.log('[LyricsService] Loaded synced lyrics (fuzzy match), lines:', this.lyrics.length);

                    if (!this.hasLyrics && bestMatch.plainLyrics) {
                        this.plainLyrics = bestMatch.plainLyrics;
                        this.hasPlainLyrics = true;
                        console.log('[LyricsService] Loaded plain lyrics as fallback');
                    }

                    return this.hasLyrics || this.hasPlainLyrics;
                } catch {
                    return false;
                }
            };

            const fixTypos = (t: string): string => {
                return t
                    .replace(/цыфр/gi, 'цифр')
                    .replace(/ЦЫФР/gi, 'ЦИФР')
                    .replace(/щас/gi, 'сейчас')
                    .replace(/чо/gi, 'что')
                    .replace(/ваще/gi, 'вообще');
            };

            const cleanTitle = (t: string) => {
                let cleaned = t;
                cleaned = cleaned.replace(/\s+by\s+\S+$/i, '');

                cleaned = cleaned.replace(/\s*[\(\[]\s*LRC\s*[\)\]]/gi, '');
                cleaned = cleaned.replace(/\s+LRC\s*$/i, '');
                const keywords = ['slowed', 'reverb', 'speed up', 'sped up', 'nightcore', 'remix', 'cover', 'mix', 'edit', 'tik tok', 'tiktok', 'official', 'audio', 'video', 'lyrics', 'bass boosted', 'extended', 'radio edit', '8d', 'lofi', 'lo-fi', 'acoustic', 'live', 'instrumental'];
                const pattern = new RegExp(`[\\(\\[][^\\)\\]]*(${keywords.join('|')})[^\\)\\]]*[\\)\\]]`, 'gi');
                cleaned = cleaned.replace(pattern, '');
                cleaned = cleaned.replace(/\s*[,+&]\s*(slowed|reverb|speed\s*up|sped\s*up|nightcore)/gi, '');
                cleaned = cleaned.replace(/\s+/g, ' ').trim();
                return cleaned || t;
            };

            const extractArtistFromTitle = (title: string): { artist: string; track: string } | null => {
                let cleanedTitle = title.replace(/\s+by\s+\S+$/i, '').trim();

                const collabMatch = cleanedTitle.match(/^(.+?)\s*[&x×]\s*(.+?)\s*[-–—:]\s*(.+)$/i);
                if (collabMatch) {
                    const mainArtist = collabMatch[1].trim();
                    const trackName = collabMatch[3].trim();
                    if (mainArtist.length > 1 && trackName.length > 1) {
                        return { artist: mainArtist, track: trackName };
                    }
                }

                const patterns = [
                    /^(.+?)\s*[-–—]\s*(.+)$/,
                    /^(.+?)\s*:\s*(.+)$/,
                    /^(.+?)\s+[""«»](.+)[""«»]$/,
                    /^(.+?)\s+"(.+)"$/,
                    /^(.+?)\s+'(.+)'$/,
                ];

                for (const pattern of patterns) {
                    const match = cleanedTitle.match(pattern);
                    if (match) {
                        let extractedArtist = match[1].trim();
                        let extractedTrack = match[2].trim();

                        extractedArtist = extractedArtist.replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '').trim();
                        extractedArtist = extractedArtist.replace(/\s*[&x×]\s+.+$/i, '').trim();

                        extractedTrack = extractedTrack.replace(/\s+by\s+\S+$/i, '').trim();

                        if (extractedArtist.length > 1 && extractedTrack.length > 1) {
                            return { artist: extractedArtist, track: extractedTrack };
                        }
                    }
                }

                const trackFirstMatch = cleanedTitle.match(/^(.+?)\s*[-–—]\s*(.+)$/);
                if (trackFirstMatch) {
                    const part1 = trackFirstMatch[1].trim();
                    const part2 = trackFirstMatch[2].trim();

                    const part1HasKeywords = /\b(remix|slowed|reverb|speed|sped|nightcore|cover|version|edit|mix)\b/i.test(part1);
                    const part2HasKeywords = /\b(remix|slowed|reverb|speed|sped|nightcore|cover|version|edit|mix)\b/i.test(part2);

                    if (part1HasKeywords && !part2HasKeywords && part2.length > 1) {
                        return { artist: part2, track: part1 };
                    }
                }

                return null;
            };

            const getMainArtist = (artistStr: string): string => {
                if (!artistStr) return '';
                return artistStr
                    .split(/\s*[&×x,]\s*/i)[0]
                    .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '')
                    .trim();
            };

            const mainArtist = getMainArtist(artist);
            const cleanedTitle = cleanTitle(track);
            const veryCleanTitle = track.replace(/[\(\[][^\)\]]*[\)\]]/g, '').trim();
            const fixedTitle = fixTypos(track);
            const fixedCleanTitle = fixTypos(cleanedTitle);

            if (mainArtist) {
                const fastQueries: Array<[string, string]> = [];
                const seen = new Set<string>();
                const pushQuery = (q: string) => {
                    const key = q.toLowerCase().trim();
                    if (!key || seen.has(key)) return;
                    seen.add(key);
                    fastQueries.push([mainArtist, q]);
                };
                pushQuery(track);
                pushQuery(cleanedTitle);
                pushQuery(veryCleanTitle);
                pushQuery(fixedTitle);
                pushQuery(fixedCleanTitle);

                const fastPromises = fastQueries.map(([a, t]) => tryFetch(a, t));
                const fastResults = await Promise.all(fastPromises);
                if (isStale()) return;
                if (fastResults.some((r) => r)) return;
            }

            if (await this.fetchFromYouTube(mainArtist || artist, track, fetchId)) return;
            if (isStale()) return;
            if (cleanedTitle !== track && (await this.fetchFromYouTube(mainArtist || artist, cleanedTitle, fetchId))) return;
            if (isStale()) return;

            const artistAliases = LyricsService.getArtistAliases(mainArtist);
            for (const alias of artistAliases.slice(1)) {
                if (await tryFetch(alias, track)) return;
                if (cleanedTitle !== track && await tryFetch(alias, cleanedTitle)) return;
            }

            const secondArtist = this.getSecondArtist(artist);
            if (secondArtist) {
                if (await tryFetch(secondArtist, track)) return;
                if (cleanedTitle !== track && await tryFetch(secondArtist, cleanedTitle)) return;

                const secondArtistAliases = LyricsService.getArtistAliases(secondArtist);
                for (const alias of secondArtistAliases.slice(1)) {
                    if (await tryFetch(alias, track)) return;
                    if (cleanedTitle !== track && await tryFetch(alias, cleanedTitle)) return;
                }
            }

            if (artist && artist !== mainArtist && await tryFetch(artist, track)) return;

            const extracted = extractArtistFromTitle(track);
            if (extracted) {
                if (await tryFetch(extracted.artist, extracted.track)) return;

                const cleanExtracted = cleanTitle(extracted.track);
                if (cleanExtracted !== extracted.track && await tryFetch(extracted.artist, cleanExtracted)) return;

                if (await tryFetch(extracted.track, extracted.artist)) return;
            }

            if (await tryFetch(track, artist)) return;
            if (await tryFetch(track, mainArtist)) return;

            if (await tryFetch('', track, false)) return;
            if (cleanedTitle !== track && await tryFetch('', cleanedTitle, false)) return;
            if (veryCleanTitle !== cleanedTitle && await tryFetch('', veryCleanTitle, false)) return;

            const trackWords = veryCleanTitle.split(/\s+/).filter(w => w.length > 1);
            if (trackWords.length > 2) {
                const shortTitle = trackWords.slice(0, 2).join(' ');
                if (mainArtist && await tryFetch(mainArtist, shortTitle)) return;
                if (await tryFetch('', shortTitle, false)) return;

                const firstWord = trackWords[0];
                if (firstWord.length > 2) {
                    if (mainArtist && await tryFetch(mainArtist, firstWord)) return;
                }
            }

            if (extracted) {
                if (await tryFetch('', extracted.track, false)) return;
                if (await tryFetch('', extracted.artist, false)) return;
            }

            const transliterated = this.transliterate(track);
            if (transliterated !== track) {
                if (mainArtist && await tryFetch(mainArtist, transliterated)) return;
                if (await tryFetch('', transliterated, false)) return;
            }

            const artistTranslit = this.transliterate(mainArtist);
            if (artistTranslit !== mainArtist) {
                if (await tryFetch(artistTranslit, track)) return;
                if (await tryFetch(artistTranslit, transliterated)) return;
            }

            if (await this.fetchFromLyricsify(mainArtist || artist, track, fetchId)) return;
            if (cleanedTitle !== track && await this.fetchFromLyricsify(mainArtist || artist, cleanedTitle, fetchId)) return;

            if (this.usePlainLyrics) {
                if (mainArtist && await tryFetch(mainArtist, track, true, true)) return;

                const allArtists = this.getAllArtists(artist);
                for (const art of allArtists) {
                    if (art !== mainArtist && await tryFetch(art, track, true, true)) return;

                    const artAliases = LyricsService.getArtistAliases(art);
                    for (const alias of artAliases.slice(1)) {
                        if (await tryFetch(alias, track, true, true)) return;
                    }
                }

                if (await tryFetch('', track, false, true)) return;
                if (cleanedTitle !== track && await tryFetch('', cleanedTitle, false, true)) return;
            }
        } catch (error) {
            console.error('Error fetching lyrics:', error);
        } finally {
            this.inFlight = false;
        }
    }

    private getAllArtists(artistStr: string): string[] {
        if (!artistStr) return [];
        const parts = artistStr.split(/\s*[&×x,]\s*/i);
        return parts.map(p => p.replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '').trim()).filter(p => p.length > 0);
    }

    private getSecondArtist(artistStr: string): string | null {
        if (!artistStr) return null;
        const parts = artistStr.split(/\s*[&×x,]\s*/i);
        if (parts.length > 1) {
            return parts[1].replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '').trim();
        }
        return null;
    }

    private async fetchFromLyricsify(artist: string, track: string, fetchId?: number): Promise<boolean> {
        try {
            const isStale = () => fetchId !== undefined && this.currentFetchId !== fetchId;
            if (isStale()) return false;

            const slug = `${artist} ${track}`
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, '')
                .replace(/\s+/g, '-')
                .substring(0, 100);

            const url = `https://www.lyricsify.com/lyrics/${slug}`;
            const response = await this.fetchUrl(url);
            if (!response || isStale()) return false;

            const lrcMatch = response.match(/\[(\d{2}:\d{2}\.\d{2,3})\]/);
            if (!lrcMatch) return false;

            const lyricsMatch = response.match(/<div[^>]*class="[^"]*lyrics[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            if (!lyricsMatch) return false;

            let lyricsContent = lyricsMatch[1]
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();

            if (isStale()) return false;
            this.lyrics = this.parseLrc(lyricsContent);
            this.hasLyrics = this.lyrics.length > 0;
            return this.hasLyrics;
        } catch {
            return false;
        }
    }

    private async fetchFromYouTube(artist: string, track: string, fetchId?: number): Promise<boolean> {
        try {
            const isStale = () => fetchId !== undefined && this.currentFetchId !== fetchId;
            if (isStale() || this.hasLyrics) return this.hasLyrics;

            const res = await this.ytGetLyrics(artist, track);
            if (isStale()) return false;

            if (res.synced && res.lines.length > 0) {
                this.lyrics = res.lines;
                this.hasLyrics = true;
                this.plainLyrics = '';
                this.hasPlainLyrics = false;
                console.log('[LyricsService] YouTube synced lyrics, lines:', this.lyrics.length);
                return true;
            }

            if (!res.synced && res.lines.length > 0 && !this.hasPlainLyrics) {
                this.plainLyrics = res.lines.map((l) => l.text).join('\n');
                this.hasPlainLyrics = true;
                console.log('[LyricsService] YouTube plain lyrics, lines:', res.lines.length);
            }
            return false;
        } catch {
            return false;
        }
    }

    public async ytGetLyrics(artist: string, track: string): Promise<{ synced: boolean; lines: LyricLine[] }> {
        const empty = { synced: false, lines: [] as LyricLine[] };
        try {
            const videoId = await this.ytSearchVideoId(`${artist} ${track}`.trim(), track);
            if (!videoId) return empty;
            const browseId = await this.ytLyricsBrowseId(videoId);
            if (!browseId) return empty;

            const resp = await this.ytPost('browse', { browseId }, true);
            const timed = resp && LyricsService.findFirstKey(resp, 'timedLyricsData');
            if (Array.isArray(timed) && timed.length > 0) {
                const synced: LyricLine[] = [];
                const plain: LyricLine[] = [];
                for (const item of timed) {
                    const text = item && item.lyricLine;
                    if (typeof text !== 'string') continue;
                    const t = text.trim();
                    plain.push({ timeMs: 0, text: t });
                    const start = item && item.cueRange && item.cueRange.startTimeMilliseconds;
                    if (start !== undefined && start !== null) {
                        synced.push({ timeMs: parseInt(String(start), 10) || 0, text: t });
                    }
                }
                if (synced.length >= Math.max(2, Math.floor(plain.length * 0.5))) {
                    return { synced: true, lines: synced.sort((a, b) => a.timeMs - b.timeMs) };
                }
                if (plain.length > 0) return { synced: false, lines: plain };
            }

            const web = await this.ytPost('browse', { browseId }, false);
            const p = web ? this.ytExtractPlain(web) : '';
            if (p) {
                return {
                    synced: false,
                    lines: p.split('\n').filter((l) => l.trim()).map((t) => ({ timeMs: 0, text: t })),
                };
            }
            return empty;
        } catch {
            return empty;
        }
    }

    public async lrclibGetLyrics(artist: string, track: string): Promise<{ synced: boolean; lines: LyricLine[] }> {
        const empty = { synced: false, lines: [] as LyricLine[] };
        try {
            const norm = (s: string) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
            const wordsOf = (s: string) => norm(s).split(' ').filter((w) => w.length > 1);

            const cleanTrack = (t: string) => {
                let c = t || '';
                c = c.replace(/\s+by\s+\S.*$/i, '');
                c = c.replace(/[\(\[][^\)\]]*\b(prod\.?|feat\.?|ft\.?|featuring|remix|rmx|cover|slowed|reverb|sped\s*up|nightcore|edit|mix|version|live|radio|extended|acoustic|instrumental|official|audio|video|lyrics|8d|lofi|lo[- ]?fi)\b[^\)\]]*[\)\]]/gi, '');
                c = c.replace(/[\(\[][^\)\]]*[\)\]]/g, ''); 
                c = c.replace(/\s+/g, ' ').trim();
                return c || t;
            };
            const mainArtist = (a: string) => (a || '').split(/\s*[&×x,]\s*/i)[0]
                .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '').trim();

            const tracks = Array.from(new Set([track, cleanTrack(track)].filter(Boolean)));
            const artists = Array.from(new Set([artist, mainArtist(artist), ''].filter((v, i, a) => a.indexOf(v) === i)));

            const queryWords = new Set(wordsOf(track).concat(wordsOf(cleanTrack(track))));

            const score = (cand: any) => {
                const tw = new Set(wordsOf(cand.trackName || ''));
                const aw = new Set(wordsOf(cand.artistName || ''));
                let trackHits = 0;
                for (const w of queryWords) if (tw.has(w)) trackHits++;
                const trackFrac = queryWords.size ? trackHits / queryWords.size : 0;
                const artistHit = artist ? (aw.has(norm(mainArtist(artist))) || norm(cand.artistName || '').includes(norm(mainArtist(artist)))) : true;
                return trackFrac + (artistHit ? 0.4 : 0);
            };

            const pick = (arr: any[]) => {
                let best: any = null;
                let bs = 0.4; 
                for (const r of arr) {
                    const sc = score(r);
                    if (sc > bs) { bs = sc; best = r; }
                }
                return best;
            };

            const decode = (r: any): { synced: boolean; lines: LyricLine[] } => {
                if (r.syncedLyrics) {
                    const lines = this.parseLrc(r.syncedLyrics);
                    if (lines.length > 0) return { synced: true, lines };
                }
                if (r.plainLyrics) {
                    return {
                        synced: false,
                        lines: String(r.plainLyrics).split('\n').filter((l: string) => l.trim()).map((t: string) => ({ timeMs: 0, text: t })),
                    };
                }
                return empty;
            };

            for (const a of artists.filter(Boolean)) {
                for (const t of tracks) {
                    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(a)}&track_name=${encodeURIComponent(t)}`;
                    const resp = await this.fetchUrl(url);
                    if (!resp) continue;
                    try {
                        const r = JSON.parse(resp);
                        if (r && (r.syncedLyrics || r.plainLyrics)) {
                            const out = decode(r);
                            if (out.lines.length > 0) return out;
                        }
                    } catch {  }
                }
            }

            for (const a of artists) {
                for (const t of tracks) {
                    const params = a
                        ? `track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`
                        : `track_name=${encodeURIComponent(t)}`;
                    const resp = await this.fetchUrl(`https://lrclib.net/api/search?${params}`);
                    if (!resp) continue;
                    try {
                        const arr = JSON.parse(resp);
                        if (!Array.isArray(arr) || arr.length === 0) continue;
                        const synced = pick(arr.filter((r: any) => r.syncedLyrics));
                        if (synced) { const out = decode(synced); if (out.lines.length > 0) return out; }
                        const plain = pick(arr.filter((r: any) => r.plainLyrics));
                        if (plain) { const out = decode(plain); if (out.lines.length > 0) return out; }
                    } catch {  }
                }
            }

            for (const t of tracks) {
                const q = encodeURIComponent(`${artist} ${t}`.trim());
                const resp = await this.fetchUrl(`https://lrclib.net/api/search?q=${q}`);
                if (!resp) continue;
                try {
                    const arr = JSON.parse(resp);
                    if (!Array.isArray(arr) || arr.length === 0) continue;
                    const synced = pick(arr.filter((r: any) => r.syncedLyrics));
                    if (synced) { const out = decode(synced); if (out.lines.length > 0) return out; }
                    const plain = pick(arr.filter((r: any) => r.plainLyrics));
                    if (plain) { const out = decode(plain); if (out.lines.length > 0) return out; }
                } catch {  }
            }

            return empty;
        } catch {
            return empty;
        }
    }

    private ytExtractPlain(resp: any): string {
        const runsArrays = LyricsService.collectKey(resp, 'runs');
        let best = '';
        for (const ra of runsArrays) {
            if (!Array.isArray(ra)) continue;
            const t = ra.map((r: any) => (r && r.text) || '').join('');
            if (t.length > best.length) best = t;
        }
        if (best.length < 40 || /show up here|become available/i.test(best)) return '';
        return best.trim();
    }

    private async ytSearchVideoId(query: string, track: string): Promise<string | null> {

        let resp = await this.ytPost('search', { query, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' });
        let items = resp ? LyricsService.collectKey(resp, 'musicResponsiveListItemRenderer') : [];
        if (items.length === 0) {
            resp = await this.ytPost('search', { query });
            items = resp ? LyricsService.collectKey(resp, 'musicResponsiveListItemRenderer') : [];
        }
        if (items.length === 0) return null;

        const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
        const trackWords = new Set(norm(track).split(/\s+/).filter((w) => w.length > 1));

        let bestId: string | null = null;
        let bestScore = -1;

        for (const item of items) {
            const vid = LyricsService.findFirstKey(item, 'videoId');
            if (typeof vid !== 'string') continue;

            const flexCol = ((item.flexColumns || [])[0] || {}).musicResponsiveListItemFlexColumnRenderer || {};
            const runs = (flexCol.text || {}).runs || [];
            const titleText = runs.map((r: any) => (r && r.text) || '').join('');
            const titleWords = norm(titleText).split(/\s+/).filter((w) => w.length > 1);

            let overlap = 0;
            for (const w of titleWords) if (trackWords.has(w)) overlap++;
            const score = trackWords.size ? overlap / trackWords.size : 1;

            if (score > bestScore) {
                bestScore = score;
                bestId = vid;
            }
        }

        if (trackWords.size > 0 && bestScore <= 0) return null;
        return bestId;
    }

    private async ytLyricsBrowseId(videoId: string): Promise<string | null> {
        const resp = await this.ytPost('next', { videoId, isAudioOnly: true });
        if (!resp) return null;
        const id = LyricsService.findFirstKey(
            resp,
            'browseId',
            (v: any) => typeof v === 'string' && v.startsWith('MPLYt'),
        );
        return typeof id === 'string' ? id : null;
    }

    private ytPost(endpoint: string, body: Record<string, unknown>, mobile: boolean = false): Promise<any | null> {
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const client = mobile
            ? { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50' }
            : { clientName: 'WEB_REMIX', clientVersion: '1.' + date + '.01.00' };
        const payload = JSON.stringify({ ...body, context: { client, user: {} } });
        const url =
            'https://music.youtube.com/youtubei/v1/' +
            endpoint +
            '?alt=json&key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30&prettyPrint=false';

        return new Promise((resolve) => {
            let settled = false;
            const finish = (v: any) => {
                if (settled) return;
                settled = true;
                resolve(v);
            };

            let request: Electron.ClientRequest;
            try {
                request = net.request({ method: 'POST', url });
            } catch {
                finish(null);
                return;
            }

            request.setHeader('Content-Type', 'application/json');
            request.setHeader('Origin', 'https://music.youtube.com');
            request.setHeader('Cookie', 'SOCS=CAI');
            request.setHeader(
                'User-Agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0',
            );

            let data = '';
            const timeout = setTimeout(() => {
                try { request.abort(); } catch {  }
                finish(null);
            }, 6000);

            request.on('response', (response: Electron.IncomingMessage) => {
                if (response.statusCode !== 200) {
                    clearTimeout(timeout);
                    finish(null);
                    return;
                }
                response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                response.on('end', () => {
                    clearTimeout(timeout);
                    try { finish(JSON.parse(data)); } catch { finish(null); }
                });
                response.on('error', () => { clearTimeout(timeout); finish(null); });
            });

            request.on('error', () => { clearTimeout(timeout); finish(null); });
            request.write(payload);
            request.end();
        });
    }

    private static findFirstKey(obj: any, key: string, predicate?: (v: any) => boolean): any {
        if (obj === null || typeof obj !== 'object') return undefined;
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const r = LyricsService.findFirstKey(item, key, predicate);
                if (r !== undefined) return r;
            }
            return undefined;
        }
        for (const k of Object.keys(obj)) {
            if (k === key && (!predicate || predicate(obj[k]))) return obj[k];
            const r = LyricsService.findFirstKey(obj[k], key, predicate);
            if (r !== undefined) return r;
        }
        return undefined;
    }

    private static collectKey(obj: any, key: string, out: any[] = []): any[] {
        if (obj === null || typeof obj !== 'object') return out;
        if (Array.isArray(obj)) {
            for (const item of obj) LyricsService.collectKey(item, key, out);
            return out;
        }
        for (const k of Object.keys(obj)) {
            if (k === key) out.push(obj[k]);
            else LyricsService.collectKey(obj[k], key, out);
        }
        return out;
    }

    private fetchUrl(url: string, timeoutMs: number = 5000): Promise<string | null> {
        return new Promise((resolve) => {
            const request = net.request(url);
            let data = '';
            let settled = false;

            const finish = (value: string | null) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const timeout = setTimeout(() => {
                try { request.abort(); } catch {  }
                finish(null);
            }, timeoutMs);

            request.on('response', (response: Electron.IncomingMessage) => {
                if (response.statusCode !== 200) {
                    clearTimeout(timeout);
                    finish(null);
                    return;
                }

                response.on('data', (chunk: Buffer) => {
                    data += chunk.toString();
                });

                response.on('end', () => {
                    clearTimeout(timeout);
                    finish(data);
                });

                response.on('error', () => {
                    clearTimeout(timeout);
                    finish(null);
                });
            });

            request.on('error', () => {
                clearTimeout(timeout);
                finish(null);
            });

            request.end();
        });
    }

    private parseLrc(lrc: string): LyricLine[] {
        const lines: LyricLine[] = [];
        const rawLines = lrc.split(/\r?\n/);

        for (const rawLine of rawLines) {
            const matches = [...rawLine.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
            if (matches.length === 0) {
                continue;
            }

            const text = rawLine.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, '').trim();
            if (!text) {
                continue;
            }

            for (const match of matches) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const fractional = match[3] || '0';
                const ms =
                    fractional.length === 1
                        ? parseInt(fractional, 10) * 100
                        : fractional.length === 2
                          ? parseInt(fractional, 10) * 10
                          : parseInt(fractional, 10);

                lines.push({
                    timeMs: minutes * 60000 + seconds * 1000 + ms,
                    text,
                });
            }
        }

        return lines.sort((a, b) => a.timeMs - b.timeMs);
    }

    public getCurrentLine(positionMs: number): LyricLine | null {
        const index = this.getLineIndex(positionMs);
        return index !== -1 ? this.lyrics[index] : null;
    }

    public getLineIndex(positionMs: number): number {
        if (!this.hasLyrics || this.lyrics.length === 0) return -1;

        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (positionMs >= this.lyrics[i].timeMs) {
                return i;
            }
        }

        return -1;
    }

    public getLyricAtIndex(index: number): LyricLine | null {
        if (index >= 0 && index < this.lyrics.length) {
            return this.lyrics[index];
        }
        return null;
    }

    public getLyricsRange(startExclusive: number, endInclusive: number): LyricLine[] {
        if (!this.hasLyrics || this.lyrics.length === 0 || endInclusive < 0 || endInclusive < startExclusive) {
            return [];
        }

        const start = Math.max(0, startExclusive + 1);
        const end = Math.min(this.lyrics.length, endInclusive + 1);
        return this.lyrics.slice(start, end);
    }

    public isHasLyrics(): boolean {
        return this.hasLyrics;
    }

    public isFetching(): boolean {
        return this.inFlight;
    }

    public getAllLines(): LyricLine[] {
        return this.lyrics.slice();
    }

    public getPlainLines(): string[] {
        return this.hasPlainLyrics ? this.plainLyrics.split('\n').filter((l) => l.trim()) : [];
    }

    public clear(): void {
        this.lyrics = [];
        this.hasLyrics = false;
        this.plainLyrics = '';
        this.hasPlainLyrics = false;
        this.lastTrack = '';
        this.lastArtist = '';

        this.currentFetchId = ++this.fetchCounter;
    }

    public getPlainLyrics(): string {
        return this.plainLyrics;
    }

    public isHasPlainLyrics(): boolean {
        return this.hasPlainLyrics;
    }

    public setUsePlainLyrics(use: boolean): void {
        this.usePlainLyrics = use;
    }

    public getPlainLyricsLine(lineIndex: number): string {
        if (!this.hasPlainLyrics) return '';
        const lines = this.plainLyrics.split('\n').filter(l => l.trim());
        if (lineIndex >= 0 && lineIndex < lines.length) {
            return lines[lineIndex];
        }
        return '';
    }

    public getPlainLyricsLineCount(): number {
        if (!this.hasPlainLyrics) return 0;
        return this.plainLyrics.split('\n').filter(l => l.trim()).length;
    }

    private transliterate(text: string): string {
        const map: { [key: string]: string } = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
            'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
            'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
            'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
            'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
            'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
            'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
            'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
            'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch', 'Ъ': '',
            'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
        };
        return text.split('').map(c => map[c] || c).join('');
    }

    public static detectSpeedMultiplier(title: string): number {
        const lower = title.toLowerCase();

        const speedUpPatterns = [
            /\bspeed\s*up\b/,
            /\bsped\s*up\b/,
            /\bnightcore\b/,
            /\bfast(er)?\s*version\b/,
            /\b(1\.[2-5]x|2x)\b/
        ];

        const slowedPatterns = [
            /\bslowed\b/,
            /\breverb\b/,
            /\bslowed\s*(\+|and|&)\s*reverb\b/,
            /\bslow(er)?\s*version\b/,
            /\b(0\.[5-9]x)\b/
        ];

        for (const pattern of speedUpPatterns) {
            if (pattern.test(lower)) {
                return 1.25;
            }
        }

        for (const pattern of slowedPatterns) {
            if (pattern.test(lower)) {
                return 0.85;
            }
        }

        return 1.0;
    }

    public generateSyncedFromPlain(durationMs: number): void {
        if (!this.hasPlainLyrics || this.hasLyrics) return;

        const lines = this.plainLyrics.split('\n').filter(l => l.trim());
        if (lines.length === 0) return;

        const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
        const startOffset = 5000;
        const endOffset = 10000;
        const availableDuration = Math.max(durationMs - startOffset - endOffset, durationMs * 0.8);

        let currentTime = startOffset;
        this.lyrics = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            this.lyrics.push({ timeMs: currentTime, text: line });

            const lineWeight = line.length / totalChars;
            const lineDuration = availableDuration * lineWeight;
            const minDuration = 1500;
            const maxDuration = 8000;
            currentTime += Math.max(minDuration, Math.min(maxDuration, lineDuration));
        }

        if (this.lyrics.length > 0) {
            this.hasLyrics = true;
        }
    }
}
