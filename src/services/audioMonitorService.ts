export const audioMonitorScript = String.raw`
(() => {
  try {
    if (window.__soundCloudMonitorActive) {
      return;
    }

    window.__soundCloudMonitorActive = true;

    let currentTrackTitle = '';
    let currentTrackAuthor = '';
    let currentTrackUrl = '';
    let currentTrackArtwork = '';
    let currentTrackElapsed = '';
    let currentTrackDuration = '';
    let currentPlaybackState = false;
    let refreshTimer = null;
    let refreshQueued = false;
    let bodyObserver = null;

    function getText(selector) {
      const element = document.querySelector(selector);
      if (!element || !element.textContent) {
        return '';
      }

      // Защита от LRC-индикатора и других "приклеенных" значков, которые могут
      // быть вставлены внутрь title-элемента: клонируем, удаляем шумовые ноды,
      // только потом читаем textContent. Без этого title мог стать
      // "Track Name LRC" и lyricsService искал совсем другой трек.
      if (element.querySelector && element.querySelector('.lrc-indicator')) {
        const clone = element.cloneNode(true);
        const indicators = clone.querySelectorAll('.lrc-indicator');
        for (let i = 0; i < indicators.length; i++) {
          indicators[i].remove();
        }
        return (clone.textContent || '').trim();
      }

      return element.textContent.trim();
    }

    function getHref(selector) {
      const element = document.querySelector(selector);
      if (!element || typeof element.href !== 'string') {
        return '';
      }

      return element.href.split('?')[0];
    }

    function getAttribute(selector, attribute) {
      const element = document.querySelector(selector);
      if (!element || typeof element.getAttribute !== 'function') {
        return '';
      }

      const value = element.getAttribute(attribute);
      return typeof value === 'string' ? value.trim() : '';
    }

    function getFirstText(selectors) {
      for (const selector of selectors) {
        const text = getText(selector);
        if (text) {
          return text;
        }
      }

      return '';
    }

    function getFirstAttribute(selectors, attribute) {
      for (const selector of selectors) {
        const value = getAttribute(selector, attribute);
        if (value) {
          return value;
        }
      }

      return '';
    }

    function stripTrackDecorations(text) {
      return text
        .replace(/\s*\|\s*Listen.*$/i, '')
        .replace(/\s*\|\s*Stream.*$/i, '')
        .replace(/^Stream\s+/i, '')
        .trim();
    }

    function stripAuthorPrefix(text, author) {
      if (!text || !author) {
        return text;
      }

      const escapedAuthor = author.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      return text.replace(new RegExp('^' + escapedAuthor + '\\s*[-–—:]\\s*', 'i'), '').trim();
    }

    function getTrackSlug(url) {
      if (!url) {
        return '';
      }

      try {
        const pathname = new URL(url).pathname.split('/').filter(Boolean);
        const slug = pathname[pathname.length - 1] || '';
        return decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
      } catch (_error) {
        return '';
      }
    }

    function getDocumentTrackTitle(author) {
      const metaTitle = stripTrackDecorations(
        getFirstAttribute(
          ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[property="twitter:title"]'],
          'content',
        ),
      );

      if (metaTitle) {
        return stripAuthorPrefix(metaTitle, author);
      }

      const pageTitle = stripTrackDecorations(document.title || '');
      if (!pageTitle) {
        return '';
      }

      const bySuffix = author ? new RegExp('\\s+by\\s+' + author.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + '$', 'i') : null;
      const cleanedTitle = bySuffix ? pageTitle.replace(bySuffix, '').trim() : pageTitle;
      return stripAuthorPrefix(cleanedTitle, author);
    }

    function getArtwork() {
      const element = document.querySelector('.playbackSoundBadge__avatar .image__lightOutline span');
      if (!element || !element.style || !element.style.backgroundImage) {
        return '';
      }

      return element.style.backgroundImage.replace(/^url\(['"]?|['"]?\)$/g, '');
    }

    function getTrackAuthor() {
      return (
        getFirstText([
          '.playbackSoundBadge__lightLink',
          '.playbackSoundBadge__titleContextContainer .playbackSoundBadge__lightLink',
          '.soundTitle__username',
          'a.soundTitle__username',
        ]) ||
        getFirstAttribute(
          ['.playbackSoundBadge__lightLink', '.soundTitle__username', 'a.soundTitle__username'],
          'title',
        )
      );
    }

    function getTrackTitle(url, author) {
      const directTitle = getFirstText([
        '.playbackSoundBadge__titleLink span[aria-hidden="true"]',
        '.playbackSoundBadge__titleLink',
        '.playbackSoundBadge__titleContextContainer a.playbackSoundBadge__titleLink',
        '.soundTitle__title span[aria-hidden="true"]',
        '.soundTitle__title',
        'h1.soundTitle__title',
      ]);

      if (directTitle) {
        return directTitle;
      }

      const titledAttribute = getFirstAttribute(
        ['.playbackSoundBadge__titleLink', '.soundTitle__title', 'h1.soundTitle__title'],
        'title',
      );

      if (titledAttribute) {
        return titledAttribute;
      }

      const documentTrackTitle = getDocumentTrackTitle(author);
      if (documentTrackTitle) {
        return documentTrackTitle;
      }

      return getTrackSlug(url);
    }

    function getTrackInfo() {
      const playButton = document.querySelector('.playControls__play');
      const url = getHref('.playbackSoundBadge__titleLink') || currentTrackUrl;
      const author = getTrackAuthor() || (url && url === currentTrackUrl ? currentTrackAuthor : '');
      const title = getTrackTitle(url, author) || (url && url === currentTrackUrl ? currentTrackTitle : '');
      const artwork = getArtwork() || (url && url === currentTrackUrl ? currentTrackArtwork : '');
      const elapsed = getText('.playbackTimeline__timePassed span:last-child') || currentTrackElapsed;
      const duration = getText('.playbackTimeline__duration span:last-child') || currentTrackDuration;

      return {
        title,
        author,
        artwork,
        elapsed,
        duration,
        isPlaying: Boolean(playButton && playButton.classList.contains('playing')),
        url,
      };
    }

    function shouldSendUpdate(trackInfo) {
      if (!window.__initialStateSent) {
        return true;
      }

      return (
        trackInfo.title !== currentTrackTitle ||
        trackInfo.author !== currentTrackAuthor ||
        trackInfo.url !== currentTrackUrl ||
        trackInfo.elapsed !== currentTrackElapsed ||
        trackInfo.duration !== currentTrackDuration ||
        trackInfo.isPlaying !== currentPlaybackState
      );
    }

    function sendTrackUpdate(reason) {
      const trackInfo = getTrackInfo();

      if (!shouldSendUpdate(trackInfo)) {
        return;
      }

      currentTrackTitle = trackInfo.title;
      currentTrackAuthor = trackInfo.author;
      currentTrackUrl = trackInfo.url;
      currentTrackArtwork = trackInfo.artwork;
      currentTrackElapsed = trackInfo.elapsed;
      currentTrackDuration = trackInfo.duration;
      currentPlaybackState = trackInfo.isPlaying;
      window.__initialStateSent = true;

      if (window.soundcloudAPI && typeof window.soundcloudAPI.sendTrackUpdate === 'function') {
        window.soundcloudAPI.sendTrackUpdate(trackInfo, reason);
      }
    }

    function ensureDownloadStyles() {
      if (document.getElementById('sc-download-btn-styles')) {
        return;
      }

      const style = document.createElement('style');
      style.id = 'sc-download-btn-styles';
      style.textContent = [
        '.sc-download-btn {',
        '  margin-left: 6px;',
        '  height: 26px;',
        '  padding: 0 10px;',
        '  border-radius: 14px;',
        '  border: 1px solid #f50;',
        '  background: transparent;',
        '  color: #f50;',
        '  font-size: 12px;',
        '  font-weight: 600;',
        '  cursor: pointer;',
        '  transition: all 0.2s ease;',
        '}',
        '.sc-download-btn:hover {',
        '  background: #f50;',
        '  color: #fff;',
        '}',
        '.sc-download-btn:disabled {',
        '  opacity: 0.5;',
        '  cursor: not-allowed;',
        '  color: #999;',
        '  border-color: #666;',
        '}',
      ].join('\n');

      if (document.head) {
        document.head.appendChild(style);
      }
    }

    function getCurrentTrackUrl() {
      return getHref('.playbackSoundBadge__titleLink') || currentTrackUrl;
    }

    async function getClientId() {
      // 1. Прямо в DOM/инлайн-скриптах (быстро, часто срабатывает).
      const inline = (document.documentElement.innerHTML || '').match(/client_id\s*[:=]\s*"?([a-zA-Z0-9]{24,})"?/);
      if (inline) return inline[1];

      // 2. В src уже загруженных скриптов (?client_id=...).
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      for (const script of scripts) {
        const match = (script.src || '').match(/client_id=([a-zA-Z0-9]{24,})/);
        if (match) return match[1];
      }

      // 3. Самый надёжный путь: качаем JS-бандлы SoundCloud (a-v2.sndcdn.com)
      //    и вытаскиваем client_id из минифицированного кода. Именно так
      //    client_id "уезжает" в реальные API-запросы плеера.
      const bundleUrls = scripts
        .map((s) => s.src)
        .filter((src) => src && (src.includes('sndcdn.com') || src.includes('soundcloud')));
      for (const url of bundleUrls.reverse()) {
        try {
          const text = await (await fetch(url)).text();
          const m = text.match(/client_id\s*[:=]\s*"?([a-zA-Z0-9]{24,})"?/);
          if (m) return m[1];
        } catch (_e) { /* пробуем следующий бандл */ }
      }
      return null;
    }

    function getOAuthToken() {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const parts = cookie.trim().split('=');
        if (parts[0] === 'oauth_token') return parts.slice(1).join('=');
      }
      try {
        const direct = window.localStorage.getItem('oauth_token');
        if (direct) return direct;
        for (const key of Object.keys(window.localStorage)) {
          if (key.toLowerCase().includes('oauth') && key.toLowerCase().includes('token')) {
            const value = window.localStorage.getItem(key);
            if (value) return value.replace(/^"|"$/g, '');
          }
        }
      } catch (_e) { /* ignore */ }
      return null;
    }

    function sanitizeFilename(name) {
      return (name || 'track')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200) || 'track';
    }

    async function apiFetchJson(url) {
      const token = getOAuthToken();
      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = 'OAuth ' + token;
      try {
        const response = await fetch(url, { headers });
        if (!response.ok) return null;
        return await response.json();
      } catch (_e) {
        return null;
      }
    }

    function bytesToBase64(bytes) {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }

    /**
     * Скачивание HLS-стрима, где сегменты закодированы в MP3 (mime audio/mpeg).
     * MP3-фреймы можно конкатенировать побайтово — на выходе валидный .mp3.
     * Качаем m3u8 → список сегментов → склеиваем → отдаём в main как base64.
     */
    async function downloadViaHls(m3u8Url, filename, setStatus) {
      const playlist = await (await fetch(m3u8Url)).text();
      const segmentUrls = playlist
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line.charAt(0) !== '#');
      if (segmentUrls.length === 0) {
        throw new Error('no-segments');
      }

      const parts = [];
      let total = 0;
      for (let i = 0; i < segmentUrls.length; i++) {
        const buffer = await (await fetch(segmentUrls[i])).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        parts.push(bytes);
        total += bytes.length;
        setStatus('Downloading… ' + Math.round(((i + 1) / segmentUrls.length) * 100) + '%');
      }

      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
      }

      return await window.soundcloudAPI.saveFile(bytesToBase64(merged), filename);
    }

    /**
     * Реальное скачивание текущего трека:
     *   1. resolve URL → JSON трека через api-v2
     *   2. media.transcodings → progressive(mp3) либо, если его нет, hls(mp3)
     *   3. GET по transcoding URL с client_id → CDN url (mp3 или m3u8)
     *   4. progressive → session.downloadURL в main; hls → склейка сегментов
     *      и сохранение через saveFile. Файл попадает в Downloads с именем
     *      "Author - Title.mp3".
     */
    async function downloadCurrentTrack(button) {
      const trackPageUrl = getCurrentTrackUrl();
      if (!trackPageUrl) return;

      const originalText = button.textContent;
      const setStatus = (text) => {
        button.textContent = text;
      };
      const restore = (delayMs) => {
        setTimeout(() => {
          if (button.isConnected) {
            button.textContent = originalText;
            button.disabled = !getCurrentTrackUrl();
          }
        }, delayMs);
      };

      button.disabled = true;
      setStatus('Resolving…');

      try {
        const clientId = await getClientId();
        if (!clientId) {
          throw new Error('client-id-missing');
        }

        const resolveUrl =
          'https://api-v2.soundcloud.com/resolve?url=' +
          encodeURIComponent(trackPageUrl) +
          '&client_id=' + clientId;

        const trackData = await apiFetchJson(resolveUrl);
        if (!trackData) {
          throw new Error('resolve-failed');
        }

        // Если resolve вернул playlist/user — нет смысла продолжать.
        if (!trackData.media || !Array.isArray(trackData.media.transcodings) || trackData.media.transcodings.length === 0) {
          throw new Error('no-media');
        }

        const transcodings = trackData.media.transcodings;
        const pickMp3 = (protocol) =>
          transcodings.find((t) => {
            if (!t || !t.format || t.format.protocol !== protocol) return false;
            const mt = (t.format.mime_type || '').toLowerCase();
            return mt.indexOf('mpeg') !== -1 || mt.indexOf('mp3') !== -1;
          });

        const progressive =
          pickMp3('progressive') ||
          transcodings.find((t) => t && t.format && t.format.protocol === 'progressive');
        const hls = pickMp3('hls');

        // Предпочитаем progressive (один GET), иначе hls(mp3) со склейкой.
        const chosen = progressive || hls;
        if (!chosen || !chosen.url) {
          throw new Error('no-stream');
        }

        setStatus('Preparing…');

        const transcodingUrl = chosen.url + (chosen.url.includes('?') ? '&' : '?') + 'client_id=' + clientId;
        const streamData = await apiFetchJson(transcodingUrl);
        if (!streamData || !streamData.url) {
          throw new Error('no-stream-url');
        }

        const author = (trackData.user && trackData.user.username) || 'Unknown';
        const title = trackData.title || 'track';
        const filename = sanitizeFilename(author + ' - ' + title) + '.mp3';

        setStatus('Downloading…');

        const isProgressive = chosen === progressive;

        if (!window.soundcloudAPI || (isProgressive && typeof window.soundcloudAPI.downloadFile !== 'function')) {
          // IPC недоступен — fallback в новое окно браузера на CDN URL.
          window.open(streamData.url, '_blank', 'noopener');
          setStatus('Opened ↗');
          restore(2000);
          return;
        }

        let result;
        if (isProgressive) {
          result = await window.soundcloudAPI.downloadFile(streamData.url, filename);
        } else {
          if (typeof window.soundcloudAPI.saveFile !== 'function') {
            throw new Error('no-saver');
          }
          result = await downloadViaHls(streamData.url, filename, setStatus);
        }

        if (result && result.ok) {
          setStatus('Saved ✓');
          restore(2500);
        } else {
          console.error('Download failed:', result);
          setStatus('Failed');
          restore(2500);
        }
      } catch (err) {
        console.error('SoundCloud download error:', err);
        const code = err && err.message;
        if (code === 'no-stream') {
          // Нет ни progressive, ни hls(mp3) — например защищённый/недоступный трек.
          setStatus('Unavailable');
        } else if (code === 'client-id-missing') {
          setStatus('No client_id');
        } else {
          setStatus('Failed');
        }
        restore(2500);
      } finally {
        button.disabled = !getCurrentTrackUrl();
      }
    }

    function triggerDownloadForCurrentTrack(button) {
      // Если в плеере SoundCloud присутствует нативная "Download file" кнопка
      // (артист её включил) — используем её, она выдаёт оригинальное качество.
      const nativeDownloadLink = document.querySelector('a.sc-button-download');
      if (nativeDownloadLink && typeof nativeDownloadLink.click === 'function') {
        nativeDownloadLink.click();
        return;
      }
      // Иначе пробуем скачать через api-v2 + progressive transcoding.
      void downloadCurrentTrack(button);
    }

    function ensureDownloadButton() {
      const controls =
        document.querySelector('.playControls__elements') ||
        document.querySelector('.playControls') ||
        document.querySelector('.playControls__inner');

      if (!controls) {
        return;
      }

      ensureDownloadStyles();

      let button = document.getElementById('sc-download-btn');
      if (!button || !button.isConnected) {
        button = document.createElement('button');
        button.id = 'sc-download-btn';
        button.className = 'sc-download-btn';
        button.type = 'button';
        button.textContent = 'Download';
        button.title = 'Download current track';
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          triggerDownloadForCurrentTrack(button);
        });
        controls.appendChild(button);
      }

      button.disabled = !getCurrentTrackUrl();
    }

    function refresh(reason) {
      try {
        ensureDownloadButton();
        sendTrackUpdate(reason);
      } catch (error) {
        console.error('Audio monitor refresh error:', error);
      }
    }

    function queueRefresh(reason) {
      if (refreshQueued) {
        return;
      }

      refreshQueued = true;
      window.setTimeout(() => {
        refreshQueued = false;
        refresh(reason);
      }, 50);
    }

    function startObserver() {
      if (!document.body) {
        return;
      }

      bodyObserver = new MutationObserver(() => {
        queueRefresh('dom-change');
      });

      bodyObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'href', 'style', 'aria-label'],
      });
    }

    function startPolling() {
      refreshTimer = window.setInterval(() => {
        refresh('poll');
      }, 1000);
    }

    function cleanup() {
      if (bodyObserver) {
        bodyObserver.disconnect();
        bodyObserver = null;
      }

      if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
      }

      window.__soundCloudMonitorActive = false;
    }

    function init() {
      refresh('initial');
      startObserver();
      startPolling();
      window.addEventListener('beforeunload', cleanup, { once: true });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }

    init();
  } catch (error) {
    console.error('Audio monitor script error:', error);
  }
})();
`;
