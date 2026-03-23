// google-calendar.js - Google Calendar event scraping
// Scrapes event detail popups and triggers recall when an event is selected.
// Depends on: core/state.js

(function() {
    'use strict';

    const googleCalendar = {};

    // Monitoring state
    let observer = null;
    let isMonitoring = false;
    let eventWasOpen = false;
    let lastEventSignature = '';
    let debounceTimer = null;
    let callbacks = null;

    const DEBOUNCE_MS = 300;

    /**
     * Check if we're on Google Calendar
     */
    googleCalendar.shouldExtract = function() {
        return window.location.hostname === 'calendar.google.com';
    };

    /**
     * Check if an event detail popup is currently open
     */
    googleCalendar.isEventOpen = function() {
        const heading = document.querySelector('#rAECCd');
        return !!(heading && heading.textContent.trim());
    };

    /**
     * Read all event fields from the currently open popup DOM.
     * Shared by getContent() and getCurrentEventSignature().
     *
     * NOTE: These selectors target internal Google Calendar DOM IDs and class
     * names (e.g. #rAECCd, #xDetDlgWhen, .XuJrye, [jsname="OLRBPb"]) that
     * are not part of any public API and may break when Google ships UI updates.
     */
    function readEventFields() {
        const title = document.querySelector('#rAECCd')?.textContent?.trim() || '';
        const time = document.querySelector('#xDetDlgWhen .AzuXid.O2VjS.CyPPBf')?.textContent?.trim() || '';
        const recurrence = document.querySelector('#xDetDlgWhen .AzuXid.Kcwcnf')?.textContent?.trim() || '';
        const organizer = document.querySelector('.XuJrye')?.textContent?.trim() || '';
        const createdBy = document.querySelector('#xDetDlgCal .AzuXid.O2VjS')?.textContent?.trim() || '';

        const guestEls = document.querySelectorAll('[jsname="OLRBPb"]');
        const guests = [];
        guestEls.forEach(el => {
            const name = el.querySelector('.SDqFWd span')?.textContent?.trim();
            const email = el.getAttribute('data-email');
            if (name && email) {
                guests.push({ name, email });
            } else if (email) {
                guests.push({ name: null, email });
            }
        });

        return { title, time, recurrence, organizer, createdBy, guests };
    }

    /**
     * Scrape the currently open event detail popup
     */
    googleCalendar.getContent = function() {
        try {
            const f = readEventFields();
            if (!f.title) return '';

            const parts = [f.title, f.time, f.recurrence];
            if (f.organizer) parts.push(`Organizer: ${f.organizer}`);
            if (f.createdBy) parts.push(`Created by: ${f.createdBy}`);
            const guestList = f.guests
                .map(g => g.email ? `${g.name || g.email} (${g.email})` : g.name)
                .filter(Boolean);
            if (guestList.length > 0) parts.push(`Guests: ${guestList.join(', ')}`);
            const text = parts.filter(Boolean).join('. ');

            return text;
        } catch (e) {
            console.error('❌ Error scraping calendar event:', e);
            return '';
        }
    };

    /**
     * Return participant email addresses from the currently open event.
     * Sent via ambience_metadata.participant_emails for entity-aware recall.
     */
    googleCalendar.getParticipantEmails = function() {
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
     * Helps detect event changes even when two events share the same title.
     */
    function getCurrentEventSignature() {
        const f = readEventFields();
        if (!f.title) return '';

        const guestEmails = f.guests
            .filter(g => g.email)
            .map(g => g.email.toLowerCase())
            .sort();

        return [
            `title:${f.title}`,
            f.time ? `when:${f.time}` : '',
            f.recurrence ? `recurrence:${f.recurrence}` : '',
            f.organizer ? `organizer:${f.organizer}` : '',
            f.createdBy ? `createdBy:${f.createdBy}` : '',
            guestEmails.length > 0 ? `guests:${guestEmails.join(',')}` : ''
        ].filter(Boolean).join('|');
    }

    /**
     * Check for event popup state changes (debounced)
     */
    function checkEventState() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const isOpen = googleCalendar.isEventOpen();
            const currentEventSignature = isOpen
                ? getCurrentEventSignature()
                : '';

            if (isOpen && (!eventWasOpen || currentEventSignature !== lastEventSignature)) {
                // Event opened or changed
                eventWasOpen = true;
                lastEventSignature = currentEventSignature;
                const currentTitle = document.querySelector('#rAECCd')?.textContent?.trim() || '(untitled)';
                if (callbacks && callbacks.onEventSelected) {
                    callbacks.onEventSelected();
                }
            } else if (!isOpen && eventWasOpen) {
                // Event closed
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
    googleCalendar.startMonitoring = function(cbs) {
        if (isMonitoring) return;
        isMonitoring = true;
        callbacks = cbs;


        observer = new MutationObserver(checkEventState);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Check initial state in case an event is already open
        checkEventState();
    };

    /**
     * Stop monitoring
     */
    googleCalendar.stopMonitoring = function() {
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
    window.Engramme.googleCalendar = googleCalendar;
})();
