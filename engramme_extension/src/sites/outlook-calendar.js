// outlook-calendar.js - Outlook Calendar event scraping
// Scrapes event detail popups and triggers recall when an event is selected.
// Depends on: core/state.js

(function() {
    'use strict';

    const outlookCalendar = {};

    // Monitoring state
    let observer = null;
    let isMonitoring = false;
    let eventWasOpen = false;
    let lastEventSignature = '';
    let debounceTimer = null;
    let callbacks = null;

    const DEBOUNCE_MS = 300;

    /**
     * Check if we're on Outlook Calendar
     */
    outlookCalendar.shouldExtract = function() {
        const utils = window.Engramme.utils;
        return utils.isOutlookHost(window.location.hostname) &&
               window.location.pathname.includes('/calendar');
    };

    /**
     * Get the event peek/popup element
     */
    function getPeekElement() {
        return document.querySelector('[data-app-section="CalendarItemPeek"]');
    }

    /**
     * Check if an event detail popup is currently open
     */
    outlookCalendar.isEventOpen = function() {
        const peek = getPeekElement();
        if (!peek) return false;
        const title = peek.querySelector('[aria-label="Title"]');
        return !!(title && title.textContent.trim());
    };

    /**
     * Read all event fields from the currently open popup DOM.
     *
     * NOTE: These selectors target internal Outlook Calendar DOM attributes
     * (e.g. [data-app-section="CalendarItemPeek"], [aria-label="Title"],
     * [aria-label="Time"], [aria-label="Location"]) that are not part of any
     * public API and may break when Microsoft ships UI updates.
     */
    function readEventFields() {
        const peek = getPeekElement();
        if (!peek) return { title: '', time: '', location: '', organizer: '', guests: [] };

        const title = peek.querySelector('[aria-label="Title"]')?.textContent?.trim() || '';
        const time = peek.querySelector('[aria-label="Time"]')?.textContent?.trim() || '';

        const locationEl = peek.querySelector('[aria-label="Location"]');
        let location = locationEl?.textContent?.trim() || '';
        if (location === 'No location added') location = '';

        // Attendees — buttons with "Opens card for" aria-label
        const attendeeBtns = peek.querySelectorAll('[aria-label^="Opens card for"]');
        const guests = [];
        let organizer = '';

        attendeeBtns.forEach(btn => {
            const label = btn.getAttribute('aria-label') || '';
            const match = label.match(/Opens card for (.+?)(?:\.\s|$)/);
            const nameOrEmail = match ? match[1] : '';
            if (!nameOrEmail) return;

            // Check if this attendee has a separate email text element
            const emailSpan = btn.querySelector('.HlQkL');
            const email = emailSpan?.textContent?.trim() || '';

            // Check if this person is the organizer
            const parentContainer = btn.closest('.LgYee, .Xv47W');
            const siblingText = parentContainer?.querySelector('.o2BOO')?.textContent?.trim() || '';
            if (siblingText.includes('organizer')) {
                organizer = nameOrEmail;
            }

            guests.push({ name: nameOrEmail, email: email || null });
        });

        return { title, time, location, organizer, guests };
    }

    /**
     * Scrape the currently open event detail popup
     */
    outlookCalendar.getContent = function() {
        try {
            const f = readEventFields();
            if (!f.title) return '';

            const parts = [f.title, f.time, f.location];
            if (f.organizer) parts.push(`Organizer: ${f.organizer}`);
            const guestList = f.guests
                .map(g => g.email ? `${g.name || g.email} (${g.email})` : g.name)
                .filter(Boolean);
            if (guestList.length > 0) parts.push(`Guests: ${guestList.join(', ')}`);
            const text = parts.filter(Boolean).join('. ');

            return text;
        } catch (e) {
            console.error('Error scraping Outlook Calendar event:', e);
            return '';
        }
    };

    /**
     * Return participant email addresses from the currently open event.
     */
    outlookCalendar.getParticipantEmails = function() {
        try {
            const f = readEventFields();
            return f.guests
                .map(g => g.email)
                .filter(Boolean)
                .map(e => e.toLowerCase().trim());
        } catch (e) {
            return [];
        }
    };

    /**
     * Build a stable signature for the currently open event.
     */
    function getCurrentEventSignature() {
        const f = readEventFields();
        if (!f.title) return '';

        const guestNames = f.guests
            .map(g => (g.email || g.name || '').toLowerCase())
            .sort();

        return [
            `title:${f.title}`,
            f.time ? `when:${f.time}` : '',
            f.location ? `location:${f.location}` : '',
            f.organizer ? `organizer:${f.organizer}` : '',
            guestNames.length > 0 ? `guests:${guestNames.join(',')}` : ''
        ].filter(Boolean).join('|');
    }

    /**
     * Check for event popup state changes (debounced)
     */
    function checkEventState() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const isOpen = outlookCalendar.isEventOpen();
            const currentEventSignature = isOpen
                ? getCurrentEventSignature()
                : '';

            if (isOpen && (!eventWasOpen || currentEventSignature !== lastEventSignature)) {
                eventWasOpen = true;
                lastEventSignature = currentEventSignature;
                const currentTitle = getPeekElement()?.querySelector('[aria-label="Title"]')?.textContent?.trim() || '(untitled)';
                if (callbacks && callbacks.onEventSelected) {
                    callbacks.onEventSelected();
                }
            } else if (!isOpen && eventWasOpen) {
                eventWasOpen = false;
                lastEventSignature = '';
                if (callbacks && callbacks.onEventClosed) {
                    callbacks.onEventClosed();
                }
            }
        }, DEBOUNCE_MS);
    }

    /**
     * Start monitoring for event popup open/close
     */
    outlookCalendar.startMonitoring = function(cbs) {
        if (isMonitoring) return;
        isMonitoring = true;
        callbacks = cbs;


        observer = new MutationObserver(checkEventState);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Check initial state
        checkEventState();
    };

    /**
     * Stop monitoring
     */
    outlookCalendar.stopMonitoring = function() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        isMonitoring = false;
        eventWasOpen = false;
        lastEventSignature = '';
        callbacks = null;
    };

    // Export
    window.Engramme = window.Engramme || {};
    window.Engramme.outlookCalendar = outlookCalendar;
})();
