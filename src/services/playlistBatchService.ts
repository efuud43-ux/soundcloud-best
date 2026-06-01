export const playlistBatchScript = String.raw`
(function() {
  try {
    if (window.__playlistBatchActive) return;
    window.__playlistBatchActive = true;

    const LONG_PRESS_DURATION = 500;
    const TRACK_ITEM_SELECTOR = '.soundList__item, .trackList__item, .searchList__item, .sound, .playlistTrackList__item, .trackItem';
    const TRACK_LINK_SELECTORS = [
      'a.soundTitle__title',
      'a.trackItem__trackTitle',
      'a.playbackSoundBadge__titleLink',
      'a[href]'
    ];
    const COLLECTION_CONTAINER_SELECTOR = '.lazyLoadingList__listItem, .systemPlaylistSquareCard, .systemPlaylistDetails__listItem, .collectionItem, .soundList__item, .trackList__item, li, article, section, .sound';
    const PLAYLIST_LIST_SELECTOR = '.trackList__list, .playlistTrackList__list, .soundList__list';

    let selectionMode = false;
    let selectedItems = new Map();
    let floatingPanel = null;
    let longPressTimer = null;
    let longPressTriggered = false;
    let currentUserId = null;
    let locationHref = location.href;
    let refreshTimer = null;

    const reorderState = {
      pageUrl: '',
      playlistId: null,
      isEnabled: false,
      isSaving: false,
      pendingOrder: null,
      draggedRow: null,
      draggedRows: [],
      dropBefore: true,
      trackOrder: [],
      trackIdsByUrl: new Map()
    };

    function createStyles() {
      if (document.getElementById('playlist-batch-styles')) return;

      const style = document.createElement('style');
      style.id = 'playlist-batch-styles';
      style.textContent = ${'`'}
        .sc-batch-selected {
          position: relative;
        }
        .sc-batch-selected::after {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(255, 85, 0, 0.14);
          border: 2px solid #f50;
          border-radius: 6px;
          pointer-events: none;
          z-index: 40;
        }
        .sc-batch-checkbox {
          position: absolute;
          top: 8px;
          left: 8px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.82);
          border: 2px solid #f50;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          z-index: 80;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;
        }
        .sc-batch-checkbox.visible {
          opacity: 1;
          pointer-events: auto;
        }
        .sc-batch-checkbox:hover {
          transform: scale(1.08);
        }
        .sc-batch-checkbox.selected {
          background: #f50;
        }
        .sc-batch-checkbox.selected::after {
          content: '+';
          transform: rotate(45deg);
        }
        .sc-batch-panel {
          position: fixed;
          left: 50%;
          bottom: 96px;
          transform: translateX(-50%);
          display: none;
          align-items: center;
          gap: 14px;
          padding: 12px 22px;
          border-radius: 999px;
          border: 1px solid rgba(255, 85, 0, 0.65);
          background: linear-gradient(135deg, #191919 0%, #272727 100%);
          box-shadow: 0 18px 36px rgba(0, 0, 0, 0.34);
          z-index: 10000;
        }
        .sc-batch-count {
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          min-width: 88px;
        }
        .sc-batch-btn {
          border: none;
          border-radius: 999px;
          padding: 9px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease, opacity 0.2s ease;
        }
        .sc-batch-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .sc-batch-btn-primary {
          background: #f50;
          color: #fff;
        }
        .sc-batch-btn-primary:hover:not(:disabled) {
          background: #ff6a1a;
        }
        .sc-batch-btn-secondary {
          background: rgba(255, 255, 255, 0.08);
          color: #d6d6d6;
        }
        .sc-batch-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.16);
        }
        .sc-batch-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10001;
        }
        .sc-batch-modal {
          width: 390px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          border-radius: 18px;
          background: linear-gradient(145deg, #1c1c1c 0%, #121212 100%);
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45);
          overflow: hidden;
        }
        .sc-batch-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 22px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .sc-batch-modal-title {
          color: #fff;
          font-size: 18px;
          font-weight: 600;
        }
        .sc-batch-modal-close {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
          color: #bdbdbd;
          font-size: 18px;
          cursor: pointer;
        }
        .sc-batch-modal-create {
          padding: 16px 22px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .sc-batch-modal-create-btn {
          width: 100%;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #f50 0%, #ff6a1a 100%);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          padding: 12px 14px;
          cursor: pointer;
        }
        .sc-batch-modal-create-form {
          display: none;
          flex-direction: column;
          gap: 12px;
        }
        .sc-batch-modal-create-form.active {
          display: flex;
        }
        .sc-batch-modal-input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          background: #252525;
          color: #fff;
          font-size: 14px;
          padding: 12px 14px;
          outline: none;
        }
        .sc-batch-modal-input:focus {
          border-color: #f50;
        }
        .sc-batch-modal-form-btns {
          display: flex;
          gap: 10px;
        }
        .sc-batch-modal-form-btns button {
          flex: 1;
          border: none;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .sc-batch-modal-form-btns .create {
          background: #f50;
          color: #fff;
        }
        .sc-batch-modal-form-btns .cancel {
          background: rgba(255, 255, 255, 0.08);
          color: #d6d6d6;
        }
        .sc-batch-modal-list {
          overflow-y: auto;
          padding: 10px 0;
        }
        .sc-batch-modal-item {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 22px;
          cursor: pointer;
          transition: background 0.2s ease;
        }
        .sc-batch-modal-item:hover {
          background: rgba(255, 85, 0, 0.08);
        }
        .sc-batch-modal-item img,
        .sc-batch-modal-item .no-artwork {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          object-fit: cover;
        }
        .sc-batch-modal-item .no-artwork {
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #f50 0%, #ff6a1a 100%);
          color: #fff;
          font-size: 15px;
          font-weight: 700;
        }
        .sc-batch-modal-item-info {
          min-width: 0;
          flex: 1;
        }
        .sc-batch-modal-item-title {
          color: #fff;
          font-size: 14px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sc-batch-modal-item-count {
          color: #8f8f8f;
          font-size: 12px;
          margin-top: 4px;
        }
        .sc-batch-modal-loading,
        .sc-batch-modal-empty {
          color: #9a9a9a;
          font-size: 14px;
          text-align: center;
          padding: 36px 20px;
        }
        .sc-batch-progress {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          min-width: 310px;
          max-width: min(92vw, 420px);
          padding: 28px 34px;
          border-radius: 18px;
          background: linear-gradient(145deg, #1d1d1d 0%, #131313 100%);
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45);
          text-align: center;
          z-index: 10002;
        }
        .sc-batch-progress-title {
          color: #fff;
          font-size: 16px;
          font-weight: 600;
        }
        .sc-batch-progress-count {
          color: #9a9a9a;
          font-size: 13px;
          margin-top: 10px;
        }
        .sc-batch-progress-bar {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          overflow: hidden;
          margin-top: 18px;
        }
        .sc-batch-progress-fill {
          width: 0;
          height: 100%;
          background: linear-gradient(90deg, #f50 0%, #ff6a1a 100%);
        }
        .sc-batch-progress-success {
          color: #fff;
          font-size: 16px;
          font-weight: 600;
        }
        .sc-long-press-indicator {
          position: absolute;
          inset: 50% auto auto 50%;
          width: 58px;
          height: 58px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          border: 3px solid transparent;
          border-top-color: #f50;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s ease;
          z-index: 70;
          animation: sc-batch-spin 0.5s linear infinite;
        }
        .sc-long-press-indicator.active {
          opacity: 1;
        }
        .sc-playlist-draggable {
          cursor: grab;
        }
        .sc-playlist-draggable.sc-playlist-dragging {
          opacity: 0.45;
        }
        .sc-playlist-drag-handle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          margin-left: 8px;
          border-radius: 50%;
          background: rgba(255, 85, 0, 0.12);
          color: #f50;
          font-size: 12px;
          font-weight: 700;
          user-select: none;
        }
        .sc-playlist-drop-before {
          box-shadow: inset 0 3px 0 #f50;
        }
        .sc-playlist-drop-after {
          box-shadow: inset 0 -3px 0 #f50;
        }
        @keyframes sc-batch-spin {
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
      ${'`'};
      document.head.appendChild(style);
    }

    function normalizeUrl(url) {
      if (!url) return '';

      try {
        const parsed = new URL(url, window.location.origin);
        return parsed.origin + parsed.pathname.replace(/\/+$/, '');
      } catch (_error) {
        return '';
      }
    }

    function isCollectionUrl(url) {
      const normalized = normalizeUrl(url);
      if (!normalized) return false;
      return normalized.includes('/sets/');
    }

    function isTrackUrl(url) {
      const normalized = normalizeUrl(url);
      if (!normalized || isCollectionUrl(normalized)) return false;

      try {
        const parsed = new URL(normalized);
        const path = parsed.pathname.replace(/\/+$/, '');
        const segments = path.split('/').filter(Boolean);

        if (segments.length < 2) return false;
        if (segments[0] === 'discover' || segments[0] === 'search' || segments[0] === 'you' || segments[0] === 'stream' || segments[0] === 'upload') {
          return false;
        }

        return true;
      } catch (_error) {
        return false;
      }
    }

    function arraysEqual(left, right) {
      if (left.length !== right.length) return false;
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false;
      }
      return true;
    }

    function buildSelectionKey(kind, url) {
      return kind + ':' + normalizeUrl(url);
    }

    function getClientId() {
      const scripts = document.querySelectorAll('script');

      for (const script of scripts) {
        const source = script.src || '';
        const match = source.match(/client_id=([^&]+)/);
        if (match) return match[1];
      }

      const htmlMatch = document.body.innerHTML.match(/"clientId":"([^"]+)"/);
      if (htmlMatch) return htmlMatch[1];

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
      } catch (_error) {
      }

      return null;
    }

    async function apiRequest(url, options) {
      const token = getOAuthToken();
      const headers = new Headers((options && options.headers) || {});

      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', 'OAuth ' + token);
      }

      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }

      try {
        return await fetch(url, Object.assign({}, options || {}, { headers }));
      } catch (_error) {
        return null;
      }
    }

    async function fetchCurrentUserId() {
      if (currentUserId !== null) return currentUserId;

      const response = await apiRequest('https://api-v2.soundcloud.com/me', {});
      if (!response || !response.ok) return null;

      try {
        const data = await response.json();
        currentUserId = data && typeof data.id === 'number' ? data.id : null;
      } catch (_error) {
        currentUserId = null;
      }

      return currentUserId;
    }

    async function resolveResource(url) {
      const normalized = normalizeUrl(url);
      if (!normalized) return null;

      const clientId = getClientId();
      const query = 'https://api-v2.soundcloud.com/resolve?url=' + encodeURIComponent(normalized) + (clientId ? '&client_id=' + clientId : '');
      const response = await apiRequest(query, {});
      if (!response || !response.ok) return null;

      try {
        return await response.json();
      } catch (_error) {
        return null;
      }
    }

    async function fetchPlaylistById(playlistId) {
      const clientId = getClientId();
      const url = 'https://api-v2.soundcloud.com/playlists/' + playlistId + (clientId ? '?client_id=' + clientId : '');
      const response = await apiRequest(url, {});
      if (!response || !response.ok) return null;

      try {
        return await response.json();
      } catch (_error) {
        return null;
      }
    }

    function extractTrackIds(resource) {
      const tracks = Array.isArray(resource && resource.tracks) ? resource.tracks : [];
      return tracks
        .map((track) => {
          if (track && typeof track.id === 'number') return track.id;
          if (typeof track === 'number') return track;
          return null;
        })
        .filter((trackId) => typeof trackId === 'number');
    }

    async function fetchUserPlaylists() {
      const ownerId = await fetchCurrentUserId();
      const response = await apiRequest('https://api-v2.soundcloud.com/me/library/all?limit=200', {});
      if (!response || !response.ok) return [];

      try {
        const data = await response.json();
        const items = Array.isArray(data && data.collection) ? data.collection : [];
        const playlists = [];

        for (const item of items) {
          const playlist = item && item.playlist;
          if (!playlist || playlist.is_album) continue;

          if (ownerId && playlist.user && playlist.user.id !== ownerId) {
            continue;
          }

          let artwork = playlist.artwork_url;
          if (!artwork && Array.isArray(playlist.tracks) && playlist.tracks.length > 0) {
            const firstTrack = playlist.tracks.find((track) => track && track.artwork_url);
            artwork = firstTrack ? firstTrack.artwork_url : '';
          }

          playlists.push({
            id: playlist.id,
            title: playlist.title || 'Untitled playlist',
            trackCount: playlist.track_count || extractTrackIds(playlist).length,
            artwork: artwork ? artwork.replace('-large', '-t300x300') : ''
          });
        }

        return playlists;
      } catch (_error) {
        return [];
      }
    }

    async function savePlaylistTracks(playlistId, trackIds) {
      const clientId = getClientId();
      const url = 'https://api-v2.soundcloud.com/playlists/' + playlistId + (clientId ? '?client_id=' + clientId : '');
      const payloads = [
        JSON.stringify({ playlist: { tracks: trackIds } }),
        JSON.stringify({ playlist: { tracks: trackIds.map((trackId) => ({ id: trackId })) } })
      ];

      for (const body of payloads) {
        const response = await apiRequest(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body
        });

        if (response && response.ok) {
          return true;
        }
      }

      const formData = new FormData();
      for (const trackId of trackIds) {
        formData.append('playlist[tracks][][id]', String(trackId));
      }

      const fallbackResponse = await apiRequest(url, {
        method: 'PUT',
        body: formData
      });

      return Boolean(fallbackResponse && fallbackResponse.ok);
    }

    async function appendTracksToPlaylist(playlistId, trackIds) {
      if (!trackIds.length) return false;

      const playlist = await fetchPlaylistById(playlistId);
      if (!playlist) return false;

      const existingTrackIds = extractTrackIds(playlist);
      const seen = new Set(existingTrackIds);
      const mergedTrackIds = existingTrackIds.slice();

      for (const trackId of trackIds) {
        if (!seen.has(trackId)) {
          seen.add(trackId);
          mergedTrackIds.push(trackId);
        }
      }

      return savePlaylistTracks(playlistId, mergedTrackIds);
    }

    function getTrackLink(element) {
      for (const selector of TRACK_LINK_SELECTORS) {
        const links = element.querySelectorAll(selector);
        for (const link of links) {
          const href = normalizeUrl(link.href);
          if (isTrackUrl(href)) return link;
        }
      }

      return null;
    }

    function getTrackUrl(element) {
      const link = getTrackLink(element);
      return link ? normalizeUrl(link.href) : '';
    }

    function getCollectionLink(element) {
      const links = element.querySelectorAll('a[href*="/sets/"]');
      for (const link of links) {
        const href = normalizeUrl(link.href);
        if (isCollectionUrl(href)) return link;
      }

      return null;
    }

    function getItemTitle(element, kind) {
      const titleSelectors = kind === 'collection'
        ? ['.systemPlaylistDetails__title', '.soundTitle__title', '.collectionItem__title', 'h1', 'h2', 'a[title]']
        : ['.soundTitle__title', '.trackItem__trackTitle', 'a[title]', 'h1', 'h2'];

      for (const selector of titleSelectors) {
        const candidate = element.querySelector(selector);
        if (!candidate) continue;

        const text = (candidate.getAttribute('title') || candidate.textContent || '').trim();
        if (text) return text;
      }

      const link = kind === 'collection' ? getCollectionLink(element) : getTrackLink(element);
      if (link) {
        const linkText = (link.getAttribute('title') || link.textContent || '').trim();
        if (linkText) return linkText;
      }

      return kind === 'collection' ? 'Collection' : 'Track';
    }

    function getArtworkContainer(element) {
      return element.querySelector('.sound__coverArt, .sc-artwork, [class*="Artwork"], .image, .sound__cover, .trackItem__artwork') || element;
    }

    function getSelectableItem(target) {
      const trackElement = target.closest(TRACK_ITEM_SELECTOR);
      if (trackElement) {
        const trackUrl = getTrackUrl(trackElement);
        if (trackUrl) {
          return {
            key: buildSelectionKey('track', trackUrl),
            kind: 'track',
            url: trackUrl,
            element: trackElement,
            title: getItemTitle(trackElement, 'track')
          };
        }
      }

      const collectionLink = target.closest('a[href*="/sets/"]');
      if (!collectionLink) return null;

      const collectionUrl = normalizeUrl(collectionLink.href);
      if (!isCollectionUrl(collectionUrl)) return null;

      const collectionElement = collectionLink.closest(COLLECTION_CONTAINER_SELECTOR) || collectionLink.parentElement;
      if (!collectionElement) return null;

      return {
        key: buildSelectionKey('collection', collectionUrl),
        kind: 'collection',
        url: collectionUrl,
        element: collectionElement,
        title: getItemTitle(collectionElement, 'collection')
      };
    }

    function getSelectionCountLabel() {
      const counts = { track: 0, collection: 0 };

      for (const item of selectedItems.values()) {
        counts[item.kind] += 1;
      }

      if (counts.collection && counts.track) {
        return counts.track + ' tracks, ' + counts.collection + ' sets';
      }

      if (counts.collection) {
        return counts.collection + ' sets';
      }

      return counts.track + ' tracks';
    }

    function createFloatingPanel() {
      const panel = document.createElement('div');
      panel.className = 'sc-batch-panel';
      panel.innerHTML =
        '<span class="sc-batch-count">0 tracks</span>' +
        '<button class="sc-batch-btn sc-batch-btn-primary" id="sc-batch-add">Add to playlist</button>' +
        '<button class="sc-batch-btn sc-batch-btn-secondary" id="sc-batch-cancel">Close</button>';

      panel.querySelector('#sc-batch-add').addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showPlaylistSelector();
      });

      panel.querySelector('#sc-batch-cancel').addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        exitSelectionMode();
      });

      document.body.appendChild(panel);
      return panel;
    }

    function updatePanel() {
      if (!floatingPanel) return;

      const count = selectedItems.size;
      const countLabel = count === 0 ? 'Nothing selected' : getSelectionCountLabel();
      const label = floatingPanel.querySelector('.sc-batch-count');
      const addButton = floatingPanel.querySelector('#sc-batch-add');

      if (label) label.textContent = countLabel;
      if (addButton) addButton.disabled = count === 0;
    }

    function applySelectedState(item) {
      item.element.classList.add('sc-batch-selected');
      const checkbox = item.element.querySelector('.sc-batch-checkbox');
      if (checkbox) checkbox.classList.add('selected');
    }

    function removeSelectedState(item) {
      if (!item || !item.element) return;
      item.element.classList.remove('sc-batch-selected');
      const checkbox = item.element.querySelector('.sc-batch-checkbox');
      if (checkbox) checkbox.classList.remove('selected');
    }

    function selectItem(item) {
      const existing = selectedItems.get(item.key);
      if (existing) {
        existing.element = item.element;
        existing.title = item.title;
        applySelectedState(existing);
      } else {
        selectedItems.set(item.key, item);
        applySelectedState(item);
      }

      updatePanel();
    }

    function deselectItem(item) {
      const existing = selectedItems.get(item.key);
      if (!existing) return;

      removeSelectedState(existing);
      selectedItems.delete(item.key);
      updatePanel();

      if (selectedItems.size === 0) {
        exitSelectionMode();
      }
    }

    function toggleItemSelection(item) {
      if (selectedItems.has(item.key)) {
        deselectItem(item);
      } else {
        selectItem(item);
      }
    }

    function addSelectionControl(item) {
      if (!item || !item.element) return;
      if (item.element.dataset.scBatchKey === item.key) {
        if (selectedItems.has(item.key)) {
          const selected = selectedItems.get(item.key);
          selected.element = item.element;
          applySelectedState(selected);
        }
        return;
      }

      const artworkContainer = getArtworkContainer(item.element);
      const checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.className = 'sc-batch-checkbox visible';
      checkbox.dataset.scBatchKey = item.key;
      checkbox.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleItemSelection({
          key: item.key,
          kind: item.kind,
          url: item.url,
          element: item.element,
          title: item.title
        });
      });

      if (artworkContainer && artworkContainer !== item.element) {
        artworkContainer.style.position = 'relative';
        artworkContainer.appendChild(checkbox);
      } else {
        item.element.style.position = 'relative';
        item.element.appendChild(checkbox);
      }

      item.element.dataset.scBatchKey = item.key;

      if (selectedItems.has(item.key)) {
        const selected = selectedItems.get(item.key);
        selected.element = item.element;
        applySelectedState(selected);
      }
    }

    function addSelectionControls() {
      const trackElements = document.querySelectorAll(TRACK_ITEM_SELECTOR);
      for (const element of trackElements) {
        const url = getTrackUrl(element);
        if (!url) continue;
        addSelectionControl({
          key: buildSelectionKey('track', url),
          kind: 'track',
          url,
          element,
          title: getItemTitle(element, 'track')
        });
      }

      const collectionLinks = document.querySelectorAll('a[href*="/sets/"]');
      for (const link of collectionLinks) {
        const url = normalizeUrl(link.href);
        if (!isCollectionUrl(url)) continue;
        const element = link.closest(COLLECTION_CONTAINER_SELECTOR) || link.parentElement;
        if (!element) continue;
        addSelectionControl({
          key: buildSelectionKey('collection', url),
          kind: 'collection',
          url,
          element,
          title: getItemTitle(element, 'collection')
        });
      }
    }

    function clearSelectionArtifacts() {
      document.querySelectorAll('.sc-batch-checkbox').forEach((element) => element.remove());
      document.querySelectorAll('.sc-batch-selected').forEach((element) => element.classList.remove('sc-batch-selected'));
      document.querySelectorAll('.sc-long-press-indicator').forEach((element) => element.remove());
      document.querySelectorAll('[data-sc-batch-key]').forEach((element) => element.removeAttribute('data-sc-batch-key'));
    }

    function enterSelectionMode(firstItem) {
      if (selectionMode) return;

      selectionMode = true;
      if (!floatingPanel) {
        floatingPanel = createFloatingPanel();
      }

      floatingPanel.style.display = 'flex';
      addSelectionControls();

      if (firstItem) {
        selectItem(firstItem);
      }

      refreshPlaylistReorder(true);
    }

    function exitSelectionMode() {
      selectionMode = false;
      selectedItems.clear();

      if (floatingPanel) {
        floatingPanel.style.display = 'none';
      }

      clearSelectionArtifacts();
      refreshPlaylistReorder(true);
    }

    function createProgress(title, subtitle) {
      const progress = document.createElement('div');
      progress.className = 'sc-batch-progress';
      progress.innerHTML =
        '<div class="sc-batch-progress-title"></div>' +
        '<div class="sc-batch-progress-count"></div>' +
        '<div class="sc-batch-progress-bar"><div class="sc-batch-progress-fill"></div></div>';

      const titleElement = progress.querySelector('.sc-batch-progress-title');
      const countElement = progress.querySelector('.sc-batch-progress-count');

      if (titleElement) titleElement.textContent = title;
      if (countElement) countElement.textContent = subtitle || '';

      document.body.appendChild(progress);
      return progress;
    }

    function updateProgress(progress, title, subtitle, percentage) {
      const titleElement = progress.querySelector('.sc-batch-progress-title');
      const countElement = progress.querySelector('.sc-batch-progress-count');
      const fillElement = progress.querySelector('.sc-batch-progress-fill');

      if (titleElement && title) titleElement.textContent = title;
      if (countElement) countElement.textContent = subtitle || '';
      if (fillElement) fillElement.style.width = Math.max(0, Math.min(100, percentage || 0)) + '%';
    }

    function finishProgress(progress, message, isSuccess) {
      progress.innerHTML = '<div class="sc-batch-progress-success"></div>';
      const titleElement = progress.querySelector('.sc-batch-progress-success');
      if (titleElement) {
        titleElement.textContent = message;
        titleElement.style.color = isSuccess ? '#fff' : '#ff8e72';
      }
    }

    async function createPlaylist(title) {
      const trimmed = title.trim();
      if (!trimmed) return null;

      const clientId = getClientId();
      const url = 'https://api-v2.soundcloud.com/playlists' + (clientId ? '?client_id=' + clientId : '');
      const response = await apiRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          playlist: {
            title: trimmed,
            sharing: 'private',
            _resource_type: 'playlist'
          }
        })
      });

      if (!response || !response.ok) return null;

      try {
        const data = await response.json();
        return {
          id: data.id,
          title: data.title || trimmed,
          trackCount: 0,
          artwork: ''
        };
      } catch (_error) {
        return null;
      }
    }

    async function resolveItemTrackIds(item) {
      const resource = await resolveResource(item.url);
      if (!resource) return [];

      if (resource.kind === 'track' && typeof resource.id === 'number') {
        return [resource.id];
      }

      if (resource.kind !== 'playlist' && resource.kind !== 'system-playlist') {
        return [];
      }

      let trackIds = extractTrackIds(resource);
      const expectedCount = typeof resource.track_count === 'number' ? resource.track_count : trackIds.length;

      if (typeof resource.id === 'number' && trackIds.length < expectedCount) {
        const fullPlaylist = await fetchPlaylistById(resource.id);
        if (fullPlaylist) {
          trackIds = extractTrackIds(fullPlaylist);
        }
      }

      return trackIds;
    }

    async function collectSelectedTrackIds(progress) {
      const items = Array.from(selectedItems.values());
      const resolvedTrackIds = [];
      const seen = new Set();

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const itemTrackIds = await resolveItemTrackIds(item);

        for (const trackId of itemTrackIds) {
          if (!seen.has(trackId)) {
            seen.add(trackId);
            resolvedTrackIds.push(trackId);
          }
        }

        updateProgress(
          progress,
          'Resolving selection',
          (index + 1) + ' / ' + items.length + ' items',
          ((index + 1) / Math.max(items.length, 1)) * 100
        );
      }

      return resolvedTrackIds;
    }

    async function addSelectionToPlaylist(playlist) {
      const progress = createProgress('Resolving selection', '0 / ' + selectedItems.size + ' items');
      const trackIds = await collectSelectedTrackIds(progress);

      if (!trackIds.length) {
        finishProgress(progress, 'No tracks found in selection', false);
        setTimeout(() => progress.remove(), 1600);
        return;
      }

      updateProgress(progress, 'Saving to "' + playlist.title + '"', trackIds.length + ' tracks', 100);
      const success = await appendTracksToPlaylist(playlist.id, trackIds);

      finishProgress(
        progress,
        success ? 'Added ' + trackIds.length + ' tracks' : 'Failed to update playlist',
        success
      );

      setTimeout(() => {
        progress.remove();
        if (success) {
          exitSelectionMode();
        }
      }, 1600);
    }

    async function showPlaylistSelector() {
      if (selectedItems.size === 0) return;

      const existing = document.querySelector('.sc-batch-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'sc-batch-overlay';
      overlay.innerHTML =
        '<div class="sc-batch-modal">' +
          '<div class="sc-batch-modal-header">' +
            '<span class="sc-batch-modal-title">Add to playlist</span>' +
            '<button type="button" class="sc-batch-modal-close">x</button>' +
          '</div>' +
          '<div class="sc-batch-modal-create">' +
            '<button type="button" class="sc-batch-modal-create-btn" id="sc-create-toggle">Create new playlist</button>' +
            '<div class="sc-batch-modal-create-form" id="sc-create-form">' +
              '<input type="text" class="sc-batch-modal-input" id="sc-playlist-name" placeholder="Playlist name">' +
              '<div class="sc-batch-modal-form-btns">' +
                '<button type="button" class="cancel" id="sc-create-cancel">Cancel</button>' +
                '<button type="button" class="create" id="sc-create-submit">Create</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sc-batch-modal-list" id="sc-playlist-list">' +
            '<div class="sc-batch-modal-loading">Loading playlists...</div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      const close = () => overlay.remove();

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          close();
        }
      });

      overlay.querySelector('.sc-batch-modal-close').addEventListener('click', close);

      const toggleButton = overlay.querySelector('#sc-create-toggle');
      const createForm = overlay.querySelector('#sc-create-form');
      const nameInput = overlay.querySelector('#sc-playlist-name');
      const createSubmit = overlay.querySelector('#sc-create-submit');
      const createCancel = overlay.querySelector('#sc-create-cancel');

      toggleButton.addEventListener('click', () => {
        toggleButton.style.display = 'none';
        createForm.classList.add('active');
        nameInput.focus();
      });

      createCancel.addEventListener('click', () => {
        createForm.classList.remove('active');
        toggleButton.style.display = 'block';
        nameInput.value = '';
      });

      createSubmit.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) return;

        createSubmit.disabled = true;
        const created = await createPlaylist(name);
        createSubmit.disabled = false;

        if (!created) {
          nameInput.style.borderColor = '#ff8e72';
          return;
        }

        close();
        addSelectionToPlaylist(created);
      });

      nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          createSubmit.click();
        }
      });

      const playlists = await fetchUserPlaylists();
      const listElement = overlay.querySelector('#sc-playlist-list');

      if (!playlists.length) {
        listElement.innerHTML = '<div class="sc-batch-modal-empty">No playlists found</div>';
        return;
      }

      listElement.innerHTML = '';

      for (const playlist of playlists) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sc-batch-modal-item';

        const artwork = playlist.artwork
          ? '<img src="' + playlist.artwork + '" alt="">' 
          : '<div class="no-artwork">SC</div>';

        item.innerHTML =
          artwork +
          '<div class="sc-batch-modal-item-info">' +
            '<div class="sc-batch-modal-item-title"></div>' +
            '<div class="sc-batch-modal-item-count"></div>' +
          '</div>';

        item.querySelector('.sc-batch-modal-item-title').textContent = playlist.title;
        item.querySelector('.sc-batch-modal-item-count').textContent = playlist.trackCount + ' tracks';

        item.addEventListener('click', () => {
          close();
          addSelectionToPlaylist(playlist);
        });

        listElement.appendChild(item);
      }
    }

    function createLongPressIndicator(item) {
      const existing = item.element.querySelector('.sc-long-press-indicator');
      if (existing) return existing;

      const indicator = document.createElement('div');
      indicator.className = 'sc-long-press-indicator';
      const container = getArtworkContainer(item.element);

      if (container && container !== item.element) {
        container.style.position = 'relative';
        container.appendChild(indicator);
      } else {
        item.element.style.position = 'relative';
        item.element.appendChild(indicator);
      }

      return indicator;
    }

    function cancelLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      document.querySelectorAll('.sc-long-press-indicator').forEach((indicator) => {
        indicator.classList.remove('active');
      });
    }

    function getPlaylistRows() {
      const container = document.querySelector(PLAYLIST_LIST_SELECTOR);
      const rows = container
        ? Array.from(container.querySelectorAll(TRACK_ITEM_SELECTOR))
        : Array.from(document.querySelectorAll(TRACK_ITEM_SELECTOR));

      return rows.filter((row) => Boolean(getTrackUrl(row)));
    }

    function getSelectedPlaylistRows() {
      return getPlaylistRows().filter((row) => {
        const key = row.dataset.scBatchKey;
        return Boolean(key && selectedItems.has(key));
      });
    }

    function clearDropIndicators() {
      document.querySelectorAll('.sc-playlist-drop-before').forEach((row) => row.classList.remove('sc-playlist-drop-before'));
      document.querySelectorAll('.sc-playlist-drop-after').forEach((row) => row.classList.remove('sc-playlist-drop-after'));
    }

    function getDropBefore(row, clientY) {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    }

    function detachReorderEnhancements() {
      const rows = document.querySelectorAll('.sc-playlist-draggable');
      rows.forEach((row) => {
        row.removeAttribute('draggable');
        row.classList.remove('sc-playlist-draggable', 'sc-playlist-dragging', 'sc-playlist-drop-before', 'sc-playlist-drop-after');
        row.removeAttribute('data-sc-playlist-track-id');
        const handle = row.querySelector('.sc-playlist-drag-handle');
        if (handle) handle.remove();
      });
      reorderState.draggedRow = null;
      reorderState.draggedRows = [];
    }

    function buildTrackIdBuckets(tracks) {
      const buckets = new Map();

      for (const track of tracks) {
        if (!track || typeof track.id !== 'number') continue;

        const url = normalizeUrl(track.permalink_url || '');
        if (!url) continue;

        if (!buckets.has(url)) {
          buckets.set(url, []);
        }

        buckets.get(url).push(track.id);
      }

      return buckets;
    }

    async function resolveCurrentPlaylistContext(forceRefresh) {
      const pageUrl = normalizeUrl(location.href);

      if (!pageUrl || !isCollectionUrl(pageUrl)) {
        reorderState.pageUrl = '';
        reorderState.playlistId = null;
        reorderState.isEnabled = false;
        reorderState.trackOrder = [];
        reorderState.trackIdsByUrl = new Map();
        detachReorderEnhancements();
        return null;
      }

      if (!forceRefresh && reorderState.pageUrl === pageUrl && reorderState.playlistId) {
        return {
          playlistId: reorderState.playlistId,
          trackOrder: reorderState.trackOrder,
          trackIdsByUrl: reorderState.trackIdsByUrl
        };
      }

      const ownerId = await fetchCurrentUserId();
      const resource = await resolveResource(pageUrl);

      if (!resource || resource.kind !== 'playlist' || resource.is_album) {
        reorderState.pageUrl = pageUrl;
        reorderState.playlistId = null;
        reorderState.isEnabled = false;
        reorderState.trackOrder = [];
        reorderState.trackIdsByUrl = new Map();
        detachReorderEnhancements();
        return null;
      }

      const canEdit = Boolean(resource.can_edit || resource.is_owned || (ownerId && resource.user && resource.user.id === ownerId));
      if (!canEdit) {
        reorderState.pageUrl = pageUrl;
        reorderState.playlistId = null;
        reorderState.isEnabled = false;
        reorderState.trackOrder = [];
        reorderState.trackIdsByUrl = new Map();
        detachReorderEnhancements();
        return null;
      }

      let playlist = resource;
      const trackOrder = extractTrackIds(resource);
      if (!trackOrder.length || (typeof resource.track_count === 'number' && trackOrder.length < resource.track_count)) {
        const fullPlaylist = await fetchPlaylistById(resource.id);
        if (fullPlaylist) {
          playlist = fullPlaylist;
        }
      }

      reorderState.pageUrl = pageUrl;
      reorderState.playlistId = playlist.id;
      reorderState.isEnabled = true;
      reorderState.trackOrder = extractTrackIds(playlist);
      reorderState.trackIdsByUrl = buildTrackIdBuckets(Array.isArray(playlist.tracks) ? playlist.tracks : []);

      return {
        playlistId: reorderState.playlistId,
        trackOrder: reorderState.trackOrder,
        trackIdsByUrl: reorderState.trackIdsByUrl
      };
    }

    async function savePlaylistOrder(order) {
      if (!reorderState.playlistId || !order.length) return;

      if (arraysEqual(order, reorderState.trackOrder)) return;

      if (reorderState.isSaving) {
        reorderState.pendingOrder = order.slice();
        return;
      }

      reorderState.isSaving = true;
      const success = await savePlaylistTracks(reorderState.playlistId, order);
      reorderState.isSaving = false;

      if (success) {
        reorderState.trackOrder = order.slice();
      } else {
        await resolveCurrentPlaylistContext(true);
        refreshPlaylistReorder(true);
      }

      if (reorderState.pendingOrder) {
        const nextOrder = reorderState.pendingOrder.slice();
        reorderState.pendingOrder = null;
        if (!arraysEqual(nextOrder, reorderState.trackOrder)) {
          savePlaylistOrder(nextOrder);
        }
      }
    }

    function handleRowDragEnd() {
      clearDropIndicators();

      reorderState.draggedRows.forEach((row) => row.classList.remove('sc-playlist-dragging'));
      reorderState.draggedRow = null;
      reorderState.draggedRows = [];
    }

    function handleRowDragStart(event) {
      if (!reorderState.isEnabled) {
        event.preventDefault();
        return;
      }

      const row = event.currentTarget;
      const trackId = row.dataset.scPlaylistTrackId;
      if (!trackId) {
        event.preventDefault();
        return;
      }

      const draggedRows = selectionMode
        ? (selectedItems.has(row.dataset.scBatchKey || '') ? getSelectedPlaylistRows() : [])
        : [row];

      if (!draggedRows.length) {
        event.preventDefault();
        return;
      }

      reorderState.draggedRow = row;
      reorderState.draggedRows = draggedRows;
      draggedRows.forEach((draggedRow) => draggedRow.classList.add('sc-playlist-dragging'));

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(
          'text/plain',
          draggedRows
            .map((draggedRow) => draggedRow.dataset.scPlaylistTrackId)
            .filter(Boolean)
            .join(','),
        );
      }
    }

    function handleRowDragOver(event) {
      if (!reorderState.draggedRow || !reorderState.draggedRows.length) return;

      const row = event.currentTarget;
      if (reorderState.draggedRows.includes(row)) return;

      event.preventDefault();
      clearDropIndicators();

      const before = getDropBefore(row, event.clientY);
      reorderState.dropBefore = before;
      row.classList.add(before ? 'sc-playlist-drop-before' : 'sc-playlist-drop-after');
    }

    function handleRowDrop(event) {
      if (!reorderState.draggedRow || !reorderState.draggedRows.length) return;

      event.preventDefault();
      const targetRow = event.currentTarget;

      if (!targetRow || reorderState.draggedRows.includes(targetRow)) {
        handleRowDragEnd();
        return;
      }

      const parent = targetRow.parentElement;
      if (!parent) {
        handleRowDragEnd();
        return;
      }

      const fragment = document.createDocumentFragment();
      reorderState.draggedRows.forEach((draggedRow) => fragment.appendChild(draggedRow));

      if (reorderState.dropBefore) {
        parent.insertBefore(fragment, targetRow);
      } else {
        parent.insertBefore(fragment, targetRow.nextSibling);
      }

      clearDropIndicators();
      reorderState.draggedRows.forEach((draggedRow) => draggedRow.classList.remove('sc-playlist-dragging'));

      const order = getPlaylistRows()
        .map((row) => Number(row.dataset.scPlaylistTrackId))
        .filter((trackId) => Number.isFinite(trackId) && trackId > 0);

      reorderState.draggedRow = null;
      reorderState.draggedRows = [];
      savePlaylistOrder(order);
    }

    function enhancePlaylistRows(context) {
      const rows = getPlaylistRows();
      const buckets = new Map();

      context.trackIdsByUrl.forEach((ids, url) => {
        buckets.set(url, ids.slice());
      });

      for (const row of rows) {
        const url = getTrackUrl(row);
        const ids = buckets.get(url) || [];
        const trackId = ids.length ? ids.shift() : null;

        row.classList.remove('sc-playlist-drop-before', 'sc-playlist-drop-after', 'sc-playlist-dragging');

        if (!trackId) {
          row.removeAttribute('draggable');
          row.removeAttribute('data-sc-playlist-track-id');
          row.classList.remove('sc-playlist-draggable');
          const handle = row.querySelector('.sc-playlist-drag-handle');
          if (handle) handle.remove();
          continue;
        }

        row.dataset.scPlaylistTrackId = String(trackId);

        if (!row.classList.contains('sc-playlist-draggable')) {
          row.classList.add('sc-playlist-draggable');
          row.setAttribute('draggable', 'true');
          row.addEventListener('dragstart', handleRowDragStart);
          row.addEventListener('dragend', handleRowDragEnd);
          row.addEventListener('dragover', handleRowDragOver);
          row.addEventListener('drop', handleRowDrop);

          const handleHost = row.querySelector('.trackItem__additional, .soundActions, .sound__body') || row;
          const handle = document.createElement('span');
          handle.className = 'sc-playlist-drag-handle';
          handle.textContent = '::';
          handleHost.appendChild(handle);
        }
      }
    }

    async function refreshPlaylistReorder(forceRefresh) {
      const context = await resolveCurrentPlaylistContext(forceRefresh);
      if (!context || !reorderState.isEnabled) {
        return;
      }

      enhancePlaylistRows(context);
    }

    function scheduleRefresh(forceRefresh) {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      refreshTimer = setTimeout(() => {
        refreshPlaylistReorder(forceRefresh);
        if (selectionMode) {
          addSelectionControls();
        }
      }, forceRefresh ? 0 : 180);
    }

    function setupLongPressHandlers() {
      document.addEventListener('pointerdown', (event) => {
        if (selectionMode) return;

        const item = getSelectableItem(event.target);
        if (!item) return;

        const indicator = createLongPressIndicator(item);

        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
          indicator.classList.remove('active');
          longPressTriggered = true;
          enterSelectionMode(item);
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
        }, LONG_PRESS_DURATION);

        setTimeout(() => {
          if (longPressTimer) {
            indicator.classList.add('active');
          }
        }, 100);
      }, true);

      document.addEventListener('pointerup', cancelLongPress, true);
      document.addEventListener('pointercancel', cancelLongPress, true);
      document.addEventListener('pointermove', (event) => {
        if (!longPressTimer) return;
        if (Math.abs(event.movementX) > 10 || Math.abs(event.movementY) > 10) {
          cancelLongPress();
        }
      }, true);

      document.addEventListener('click', (event) => {
        if (longPressTriggered) {
          longPressTriggered = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (!selectionMode) return;

        if (event.target.closest('.sc-batch-panel') || event.target.closest('.sc-batch-overlay') || event.target.closest('.sc-playlist-drag-handle')) {
          return;
        }

        const item = getSelectableItem(event.target);
        if (!item) return;

        event.preventDefault();
        event.stopPropagation();
        toggleItemSelection(item);
      }, true);
    }

    function observePageChanges() {
      const observer = new MutationObserver(() => {
        if (locationHref !== location.href) {
          locationHref = location.href;
          cancelLongPress();
          clearDropIndicators();
          scheduleRefresh(true);
        } else {
          scheduleRefresh(false);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('popstate', () => scheduleRefresh(true));
      window.addEventListener('beforeunload', () => observer.disconnect());
      setInterval(() => {
        if (locationHref !== location.href) {
          locationHref = location.href;
          scheduleRefresh(true);
        }
      }, 1000);
    }

    function init() {
      createStyles();
      setupLongPressHandlers();
      observePageChanges();
      scheduleRefresh(true);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      init();
    } else {
      document.addEventListener('DOMContentLoaded', init);
    }
  } catch (error) {
    console.error('Playlist batch script error:', error);
  }
})();
`;
