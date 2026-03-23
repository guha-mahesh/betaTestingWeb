// canary.js - Canary card injection for quality testing
// Randomly prepends a fake "canary" memory card to recall results
// Default 3% chance per recall

(function() {
    'use strict';

    const CANARY_INJECTION_PERCENT = 3;
    let _cards = null;
    let _loadPromise = null;

    function loadCards() {
        if (_loadPromise) return _loadPromise;
        _loadPromise = fetch(chrome.runtime.getURL('assets/canary_cards.json'))
            .then(r => r.json())
            .then(cards => { _cards = cards; return cards; })
            .catch(() => { _cards = []; return []; });
        return _loadPromise;
    }

    // Eagerly start loading
    loadCards();

    function transformCanary(card) {
        const sourceMapping = {
            'calendar': 'calendar', 'email': 'email', 'slack': 'slack',
            'microsoft': 'microsoft', 'zoom': 'zoom', 'asana': 'asana',
            'browser': 'browser', 'text': 'text', 'pdf': 'pdf',
            'meet': 'meet', 'stream': 'stream'
        };
        const rawSource = (card.source || '').toLowerCase();
        const source = sourceMapping[rawSource] || rawSource;

        let when = '';
        if (card.when && card.when.eventStartTime) {
            try {
                const d = new Date(card.when.eventStartTime);
                when = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (e) { when = ''; }
        }

        const entityNames = (card.entities || []).map(e => e.name).filter(Boolean);

        return {
            event_id: card.event_id,
            headline: card.headline || '',
            narrative: card.narrative || '',
            participants: card.participants || [],
            entities: entityNames,
            entitiesWithTypes: card.entities || [],
            when: when,
            where: card.where || '',
            what_and_why: '',
            tags: card.tags || [],
            similarity: card.score || 0.9,
            source: source,
            source_metadata: null,
            _isCanary: true
        };
    }

    /**
     * Maybe inject a canary card at position 0 of the memories array.
     * Returns the (possibly modified) array. Never mutates the input.
     */
    async function maybeInject(memories) {
        if (!_cards) await loadCards();
        if (!_cards || _cards.length === 0) return memories;

        const roll = Math.random() * 100;
        if (roll >= CANARY_INJECTION_PERCENT) return memories;

        const canary = _cards[Math.floor(Math.random() * _cards.length)];
        const transformed = transformCanary(canary);
        return [transformed, ...memories];
    }

    window.Engramme.canary = { maybeInject };
})();
