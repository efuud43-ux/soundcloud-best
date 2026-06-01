export const lrcIndicatorScript = `
(function() {
    try {
    if (window.__lrcIndicatorInitialized) return;
    window.__lrcIndicatorInitialized = true;

    const style = document.createElement('style');
    style.textContent = \`
        .lrc-indicator {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #ff5500, #ff7700);
            color: white;
            font-size: 9px;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 3px;
            margin-left: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            vertical-align: middle;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            animation: lrcPulse 2s ease-in-out infinite;
        }
        @keyframes lrcPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.8; }
        }
        .lrc-indicator-checking {
            background: #666;
            animation: none;
        }
    \`;
    document.head.appendChild(style);

    const checkedTracks = new Map();
    let checkQueue = [];
    let isProcessing = false;

    async function checkLyrics(artist, track) {
        const key = artist + '|' + track;
        if (checkedTracks.has(key)) {
            return checkedTracks.get(key);
        }

        if (!window.soundcloudAPI || !window.soundcloudAPI.checkLyrics) {
            return false;
        }

        try {
            const hasLyrics = await window.soundcloudAPI.checkLyrics(artist, track);
            checkedTracks.set(key, hasLyrics);
            return hasLyrics;
        } catch (e) {
            return false;
        }
    }

    function extractTrackInfo(element) {
        const titleEl = element.querySelector('.soundTitle__title span, .trackItem__trackTitle, .chartTrack__title span');
        const artistEl = element.querySelector('.soundTitle__username, .trackItem__username, .chartTrack__username');

        if (!titleEl) return null;

        const title = titleEl.textContent?.trim() || '';
        const artist = artistEl?.textContent?.trim() || '';

        return { title, artist };
    }

    function addIndicator(element, hasLyrics) {
        const existing = element.querySelector('.lrc-indicator');
        if (existing) {
            if (hasLyrics) {
                existing.classList.remove('lrc-indicator-checking');
                existing.textContent = 'LRC';
            } else {
                existing.remove();
            }
            return;
        }

        if (!hasLyrics) return;

        const titleEl = element.querySelector('.soundTitle__title, .trackItem__trackTitle, .chartTrack__title');
        if (!titleEl) return;

        const indicator = document.createElement('span');
        indicator.className = 'lrc-indicator';
        indicator.textContent = 'LRC';
        indicator.title = 'Synced lyrics available';
        // ВАЖНО: вставляем СНАРУЖИ titleEl, иначе textContent у titleEl
        // станет "Track Name LRC" и audioMonitor пошлёт битый title в RPC,
        // а lyricsService будет искать совсем другой трек.
        if (titleEl.parentNode) {
            titleEl.parentNode.insertBefore(indicator, titleEl.nextSibling);
        } else {
            titleEl.appendChild(indicator);
        }
    }

    async function processElement(element) {
        const info = extractTrackInfo(element);
        if (!info || !info.title) return;

        const hasLyrics = await checkLyrics(info.artist, info.title);
        addIndicator(element, hasLyrics);
    }

    function scanPage() {
        const selectors = [
            '.soundList__item',
            '.trackItem',
            '.chartTrack',
            '.sound__body',
            '.playableTile',
            '.searchList__item'
        ];

        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (!el.dataset.lrcChecked) {
                    el.dataset.lrcChecked = 'true';
                    processElement(el);
                }
            });
        });
    }

    const observer = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldScan = true;
                break;
            }
        }
        if (shouldScan) {
            setTimeout(scanPage, 500);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    setTimeout(scanPage, 1000);
    setInterval(scanPage, 5000);
    } catch (error) {
        console.error('LRC indicator script error:', error);
    }
})();
`;
