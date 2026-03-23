// recall-inspector.js - Floating button and modal for inspecting recall API requests and trace reports
// Shows the last recall request payload, full pipeline trace, and live transcript
// Depends on: core/state.js

(function() {
    'use strict';

    const recallInspector = {};
    const state = window.Engramme.state;

    /**
     * Create the floating recall inspector button in bottom left corner
     */
    recallInspector.createButton = function() {
        // Don't create duplicate buttons
        if (document.getElementById('engramme-recall-inspector-button')) {
            return;
        }

        const inspectorButton = document.createElement('button');
        inspectorButton.id = 'engramme-recall-inspector-button';
        inspectorButton.innerHTML = '🐛';
        inspectorButton.title = 'Show Recall Debug Info (Ctrl+Shift+X)';
        inspectorButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            cursor: pointer;
            font-size: 20px;
            z-index: 999999;
            opacity: 0.4;
            transition: opacity 0.2s, transform 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        inspectorButton.addEventListener('mouseenter', () => {
            inspectorButton.style.opacity = '1';
            inspectorButton.style.transform = 'scale(1.1)';
        });

        inspectorButton.addEventListener('mouseleave', () => {
            inspectorButton.style.opacity = '0.4';
            inspectorButton.style.transform = 'scale(1)';
        });

        inspectorButton.addEventListener('click', () => {
            recallInspector.showModal();
        });

        document.body.appendChild(inspectorButton);
    };

    // ========================================
    // Helper Functions
    // ========================================

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Format text content for display - splits headlines into readable list
     */
    function formatTextForDisplay(text) {
        if (!text) return '<code style="color: #6b7280;">No text content</code>';

        const headlinePatterns = [
            /^SF Chronicle Headlines:\n/,
            /^NYT Headlines:\n/,
            /^Google Search:/
        ];

        const isHeadlineFormat = headlinePatterns.some(pattern => pattern.test(text));

        if (isHeadlineFormat) {
            const lines = text.split('\n').filter(line => line.trim());
            const header = lines[0];
            const items = lines.slice(1);

            if (items.length > 0) {
                const listItems = items.map((item, i) =>
                    `<div style="padding: 8px 12px; background: ${i % 2 === 0 ? '#f3f4f6' : '#e5e7eb'}; border-radius: 4px; margin-bottom: 4px; color: #111; font-size: 13px;">${escapeHtml(item)}</div>`
                ).join('');

                return `
                    <div style="margin-bottom: 8px; color: #6366f1; font-weight: 600; font-size: 13px;">${escapeHtml(header)}</div>
                    <div style="max-height: 300px; overflow-y: auto;">${listItems}</div>
                `;
            }
        }

        return `<code style="color: #111; word-break: break-word; white-space: pre-wrap;">${escapeHtml(text)}</code>`;
    }

    /**
     * Format a duration in ms for display
     */
    function fmtMs(ms) {
        if (ms == null) return '—';
        return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
    }

    /**
     * Build a collapsible section
     */
    function collapsibleSection(title, contentHtml, startOpen) {
        const id = 'engramme-collapse-' + Math.random().toString(36).slice(2, 9);
        const chevron = startOpen ? '▼' : '▶';
        const display = startOpen ? 'block' : 'none';
        return `
            <div style="margin-bottom: 12px;">
                <div id="${id}-header" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                    <span id="${id}-chevron" style="font-size: 10px; color: #6b7280; width: 14px;">${chevron}</span>
                    <strong style="color: #111; font-size: 14px;">${title}</strong>
                </div>
                <div id="${id}-body" style="display: ${display}; padding-top: 8px;">
                    ${contentHtml}
                </div>
            </div>
        `;
    }

    /**
     * Attach toggle listeners for all collapsible sections in a container
     */
    function attachCollapsibleListeners(container) {
        const headers = container.querySelectorAll('[id$="-header"]');
        headers.forEach(header => {
            const baseId = header.id.replace('-header', '');
            const chevron = container.querySelector(`#${baseId}-chevron`);
            const body = container.querySelector(`#${baseId}-body`);
            if (!chevron || !body) return;
            header.addEventListener('click', () => {
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                chevron.textContent = isOpen ? '▶' : '▼';
            });
        });
    }

    // ========================================
    // ID Alias System
    // ========================================

    let aliasMap = new Map();

    /**
     * Build alias map from all unique IDs in the trace.
     * IDs are assigned in the order they first appear in Pinecone results,
     * then any remaining from filters/final results.
     */
    function buildAliasMap(trace) {
        aliasMap = new Map();
        const seen = new Set();
        let counter = 1;

        function register(id) {
            const str = String(id);
            if (!str || seen.has(str)) return;
            seen.add(str);
            aliasMap.set(str, `id-${counter}`);
            counter++;
        }

        if (trace.pinecone_recall?.results) {
            for (const hits of Object.values(trace.pinecone_recall.results)) {
                if (!Array.isArray(hits)) continue;
                for (const hit of hits) {
                    register(hit.custom_id || hit.id);
                }
            }
        }

        if (trace.filters) {
            for (const filter of Object.values(trace.filters)) {
                if (!filter || typeof filter !== 'object') continue;
                if (Array.isArray(filter.input_ids)) filter.input_ids.forEach(register);
                if (Array.isArray(filter.output_ids)) filter.output_ids.forEach(register);
                if (Array.isArray(filter.removed_ids)) filter.removed_ids.forEach(register);
                if (Array.isArray(filter.groups)) {
                    for (const group of filter.groups) {
                        if (Array.isArray(group)) group.forEach(register);
                    }
                }
            }
        }

        if (trace.final_result) {
            for (const ids of Object.values(trace.final_result)) {
                if (Array.isArray(ids)) ids.forEach(register);
            }
        }
    }

    /**
     * Resolve a real ID to its short alias, or fall back to the raw ID.
     */
    function alias(realId) {
        const str = String(realId);
        return aliasMap.get(str) || str;
    }

    /**
     * Build a collapsible ID Legend table mapping aliases to real IDs.
     */
    function buildIdLegendSection() {
        if (aliasMap.size === 0) return '';
        const rows = Array.from(aliasMap.entries()).map(([realId, shortAlias]) =>
            `<tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 3px 10px; font-size: 12px; font-weight: 600; font-family: monospace; color: #6366f1; white-space: nowrap;">${escapeHtml(shortAlias)}</td>
                <td style="padding: 3px 10px; font-size: 11px; font-family: monospace; color: #374151; word-break: break-all;">${escapeHtml(realId)}</td>
            </tr>`
        ).join('');

        const content = `
            <table style="width: 100%; border-collapse: collapse;">
                <tr style="background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                    <th style="padding: 4px 10px; font-size: 10px; text-align: left; color: #6b7280;">Alias</th>
                    <th style="padding: 4px 10px; font-size: 10px; text-align: left; color: #6b7280;">Real ID</th>
                </tr>
                ${rows}
            </table>
        `;
        return collapsibleSection(`ID Legend (${aliasMap.size} IDs)`, content, false);
    }

    /**
     * Render a list of IDs as compact pills using short aliases
     */
    function renderIdPills(ids, color) {
        if (!ids || ids.length === 0) return '<span style="color: #9ca3af; font-size: 12px;">none</span>';
        return ids.map(id =>
            `<span title="${escapeHtml(String(id))}" style="display: inline-block; padding: 2px 8px; margin: 2px; border-radius: 4px; background: ${color}; font-size: 11px; font-family: monospace; color: #111; cursor: default;">${escapeHtml(alias(id))}</span>`
        ).join('');
    }

    /**
     * Render a key-value row
     */
    function kvRow(label, value) {
        return `
            <div style="display: flex; gap: 8px; margin-bottom: 4px; font-size: 13px;">
                <span style="color: #6366f1; font-weight: 600; white-space: nowrap; min-width: 120px;">${label}:</span>
                <span style="color: #111; word-break: break-all;">${value}</span>
            </div>
        `;
    }

    // ========================================
    // Request Payload Tab
    // ========================================

    function buildRequestTabHTML() {
        const payload = state.lastRecallPayload;
        if (!payload) {
            return `<p style="color: #6b7280; font-size: 14px;">No recall requests have been made yet. Trigger a recall request to see the payload here.</p>`;
        }

        const pretruncationTextLength = typeof payload.pretruncationTextLength === 'number'
            ? payload.pretruncationTextLength
            : payload.textLength;
        const wasTruncated = typeof payload.wasTruncated === 'boolean'
            ? payload.wasTruncated
            : pretruncationTextLength > payload.textLength;
        const truncationLabel = wasTruncated
            ? (payload.truncationMode === 'last_1000_chars' ? 'truncated to last 1000' : 'truncated')
            : 'not truncated';
        const status = payload.status || (payload.confirmed ? 'confirmed' : 'pending');
        const statusBadge = status === 'confirmed'
            ? '<span style="background: #22c55e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">CONFIRMED SENT</span>'
            : status === 'failed'
                ? '<span style="background: #dc2626; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">FAILED</span>'
                : '<span style="background: #f59e0b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">PENDING</span>';

        return `
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; font-family: 'Monaco', 'Menlo', monospace; font-size: 12px; line-height: 1.6;">
                <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    <strong style="color: #6366f1;">Status:</strong>
                    ${statusBadge}
                </div>
                ${status === 'failed' && payload.error
                    ? `<div style="margin-bottom: 12px;"><strong style="color: #dc2626;">Error:</strong><br><code style="color: #7f1d1d; white-space: pre-wrap;">${escapeHtml(String(payload.error))}</code></div>`
                    : ''}
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">URL:</strong><br>
                    <code style="color: #111;">${payload.url}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Method:</strong><br>
                    <code style="color: #111;">${payload.method}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Headers:</strong><br>
                    <code style="color: #111;">${JSON.stringify(payload.headers, null, 2)}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Form Data (text):</strong><br>
                    ${formatTextForDisplay(payload.formData.text)}
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Form Data (top_k):</strong><br>
                    <code style="color: #111;">${payload.formData.top_k}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">LLM Proxy Filter:</strong><br>
                    <code style="color: #111;">${payload.formData.enable_llm_proxy_filter ?? 'N/A'}${payload.formData.llm_proxy_filter_is_soft ? ' (soft)' : ''}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Alpha:</strong><br>
                    <code style="color: #111;">${payload.formData.alpha ?? 'N/A'}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Participant Match:</strong><br>
                    <code style="color: #111;">${escapeHtml(String(payload.formData.participant_match_mode ?? 'N/A'))}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Diversity/Dedup:</strong><br>
                    <code style="color: #111;">${escapeHtml(String(payload.formData.diversity_match_mode ?? 'N/A'))}</code>
                </div>
                ${payload.formData.source_filter ? `<div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Source Filter:</strong><br>
                    <code style="color: #111;">${escapeHtml(payload.formData.source_filter)}</code>
                </div>` : ''}
                ${payload.formData.sim_threshold ? `<div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Similarity Threshold:</strong><br>
                    <code style="color: #111;">${payload.formData.sim_threshold}</code>
                </div>` : ''}
                ${payload.formData.min_age || (payload.formData.max_age && payload.formData.max_age !== 365) ? `<div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Age Window:</strong><br>
                    <code style="color: #111;">${payload.formData.min_age ?? 0} – ${payload.formData.max_age ?? 365} days</code>
                </div>` : ''}
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Enable Trace:</strong><br>
                    <code style="color: #111;">${payload.formData.enable_trace ?? 'N/A'}</code>
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Ambience Metadata:</strong><br>
                    ${payload.formData.ambience_metadata
                        ? `<code style="color: #111; white-space: pre-wrap;">${escapeHtml(typeof payload.formData.ambience_metadata === 'string' ? payload.formData.ambience_metadata : JSON.stringify(payload.formData.ambience_metadata, null, 2))}</code>`
                        : '<code style="color: #9ca3af;">None (no participant emails)</code>'}
                </div>
                <div style="margin-bottom: 12px;">
                    <strong style="color: #6366f1;">Text Length:</strong><br>
                    <code style="color: #111;">${pretruncationTextLength} characters (${truncationLabel})</code>
                    ${wasTruncated
                        ? `<br><code style="color: #6b7280;">sent: ${payload.textLength} characters</code>`
                        : ''}
                </div>
                <div>
                    <strong style="color: #6366f1;">Timestamp:</strong><br>
                    <code style="color: #111;">${payload.timestamp}</code>
                </div>
            </div>
        `;
    }

    // ========================================
    // Trace Tab
    // ========================================

    /**
     * Build the timing bar HTML showing proportional durations
     */
    function buildTimingBarHTML(trace) {
        const segments = [];
        const colors = {
            pinecone: '#6366f1',
            content: '#8b5cf6',
            date: '#a78bfa',
            entity: '#f59e0b',
            llm_proxy: '#ef4444',
            diversity: '#10b981'
        };
        const labels = {
            pinecone: 'Pinecone',
            content: 'Content Fetch',
            date: 'Date Filter',
            entity: 'Entity Filter',
            llm_proxy: 'LLM Proxy',
            diversity: 'Diversity Filter'
        };

        if (trace.pinecone_recall?.duration_ms) {
            segments.push({ key: 'pinecone', ms: trace.pinecone_recall.duration_ms });
        }
        if (trace.content_fetch?.duration_ms) {
            segments.push({ key: 'content', ms: trace.content_fetch.duration_ms });
        }
        if (trace.filters?.date_filter?.duration_ms) {
            segments.push({ key: 'date', ms: trace.filters.date_filter.duration_ms });
        }
        if (trace.filters?.entity_filter?.duration_ms) {
            segments.push({ key: 'entity', ms: trace.filters.entity_filter.duration_ms });
        }
        if (trace.filters?.llm_proxy_filter?.duration_ms) {
            segments.push({ key: 'llm_proxy', ms: trace.filters.llm_proxy_filter.duration_ms });
        }
        if (trace.filters?.diversity_filter?.duration_ms) {
            segments.push({ key: 'diversity', ms: trace.filters.diversity_filter.duration_ms });
        }

        const totalMs = trace.total_duration_ms || segments.reduce((sum, s) => sum + s.ms, 0);
        if (totalMs === 0 || segments.length === 0) return '';

        const barSegments = segments.map(s => {
            const pct = Math.max((s.ms / totalMs) * 100, 2);
            return `<div title="${labels[s.key]}: ${fmtMs(s.ms)}" style="
                width: ${pct}%;
                background: ${colors[s.key]};
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 10px;
                font-weight: 600;
                white-space: nowrap;
                overflow: hidden;
                min-width: 20px;
            ">${pct > 8 ? fmtMs(s.ms) : ''}</div>`;
        }).join('');

        const legend = segments.map(s =>
            `<span style="display: inline-flex; align-items: center; gap: 4px; margin-right: 12px; font-size: 11px;">
                <span style="width: 10px; height: 10px; border-radius: 2px; background: ${colors[s.key]}; display: inline-block;"></span>
                ${labels[s.key]} (${fmtMs(s.ms)})
            </span>`
        ).join('');

        return `
            <div style="margin-bottom: 16px;">
                <div style="font-size: 13px; font-weight: 600; color: #111; margin-bottom: 6px;">
                    Pipeline Timing — Total: ${fmtMs(totalMs)}
                </div>
                <div style="display: flex; border-radius: 6px; overflow: hidden; border: 1px solid #e5e7eb;">
                    ${barSegments}
                </div>
                <div style="margin-top: 6px; line-height: 1.8;">
                    ${legend}
                </div>
            </div>
        `;
    }

    /**
     * Build the trace request section
     */
    function buildTraceRequestSection(req) {
        if (!req) return '';
        const topKStr = req.top_k ? Object.entries(req.top_k).map(([k, v]) => `${k}: ${v}`).join(', ') : '—';
        const content = `
            ${kvRow('Query', `<code style="font-size: 12px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(req.query || '')}</code>`)}
            ${kvRow('Top K', topKStr)}
            ${kvRow('LLM Proxy Filter', req.enable_llm_proxy_filter ? 'Enabled' : 'Disabled')}
            ${req.llm_proxy_filter_is_soft != null ? kvRow('Soft Mode', req.llm_proxy_filter_is_soft ? 'Yes' : 'No') : ''}
            ${req.participant_match_mode ? kvRow('Participant Match', req.participant_match_mode) : ''}
            ${req.diversity_match_mode ? kvRow('Diversity Match', req.diversity_match_mode) : ''}
            ${req.serving_version ? kvRow('Serving Version', req.serving_version) : ''}
        `;
        return collapsibleSection('Request Parameters', content, false);
    }

    /**
     * Build the Pinecone recall section
     */
    function buildPineconeSection(pinecone) {
        if (!pinecone) return '';

        const results = pinecone.results || {};
        const countRows = Object.entries(results).map(([type, hits]) =>
            `<span style="margin-right: 16px; font-size: 13px;"><strong>${type}:</strong> ${Array.isArray(hits) ? hits.length : 0}</span>`
        ).join('');

        let hitsDetail = '';
        for (const [type, hits] of Object.entries(results)) {
            if (!Array.isArray(hits) || hits.length === 0) continue;
            const rows = hits.map((hit, i) => {
                const id = hit.custom_id || hit.id || '?';
                const score = hit.score != null ? hit.score.toFixed(4) : '—';
                const headline = hit.content?.headline || hit.metadata?.headline || '';
                return `<tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 4px 8px; font-size: 11px; color: #6b7280;">${i + 1}</td>
                    <td title="${escapeHtml(String(id))}" style="padding: 4px 8px; font-size: 11px; font-family: monospace; font-weight: 600; color: #6366f1; cursor: default;">${escapeHtml(alias(id))}</td>
                    <td style="padding: 4px 8px; font-size: 11px; font-weight: 600;">${score}</td>
                    <td style="padding: 4px 8px; font-size: 11px; color: #374151; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(headline)}</td>
                </tr>`;
            }).join('');

            hitsDetail += `
                <div style="margin-top: 8px; font-size: 12px; font-weight: 600; color: #6366f1;">${type} hits</div>
                <table style="width: 100%; border-collapse: collapse; margin-top: 4px;">
                    <tr style="background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                        <th style="padding: 4px 8px; font-size: 10px; text-align: left; color: #6b7280;">#</th>
                        <th style="padding: 4px 8px; font-size: 10px; text-align: left; color: #6b7280;">ID</th>
                        <th style="padding: 4px 8px; font-size: 10px; text-align: left; color: #6b7280;">Score</th>
                        <th style="padding: 4px 8px; font-size: 10px; text-align: left; color: #6b7280;">Headline</th>
                    </tr>
                    ${rows}
                </table>
            `;
        }

        const content = `
            ${kvRow('Duration', fmtMs(pinecone.duration_ms))}
            <div style="margin-bottom: 8px;">${countRows}</div>
            ${hitsDetail}
        `;
        return collapsibleSection(`Pinecone Recall — ${fmtMs(pinecone.duration_ms)}`, content, true);
    }

    /**
     * Build the content fetch section
     */
    function buildContentFetchSection(cf) {
        if (!cf) return '';
        const counts = cf.fetched_count || {};
        const countStr = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
        const content = `
            ${kvRow('Duration', fmtMs(cf.duration_ms))}
            ${kvRow('Fetched', countStr)}
        `;
        return collapsibleSection(`Content Fetch — ${fmtMs(cf.duration_ms)}`, content, false);
    }

    /**
     * Build a filter step section
     */
    function buildFilterSection(name, filter, colorIn, colorOut, colorRemoved) {
        if (!filter) return '';

        const inputCount = filter.input_ids ? filter.input_ids.length : 0;
        const outputCount = filter.output_ids ? filter.output_ids.length : 0;
        const removedCount = filter.removed_ids ? filter.removed_ids.length : 0;

        let extraRows = '';

        if (filter.enabled != null) {
            extraRows += kvRow('Enabled', filter.enabled ? 'Yes' : 'No');
        }
        if (filter.match_mode) {
            extraRows += kvRow('Match Mode', filter.match_mode);
        }

        if (filter.query_entities) {
            const ents = filter.query_entities;
            const parts = [];
            if (ents.participants?.length) parts.push(`<strong>People:</strong> ${ents.participants.map(e => escapeHtml(e)).join(', ')}`);
            if (ents.organizations?.length) parts.push(`<strong>Orgs:</strong> ${ents.organizations.map(e => escapeHtml(e)).join(', ')}`);
            if (ents.places?.length) parts.push(`<strong>Places:</strong> ${ents.places.map(e => escapeHtml(e)).join(', ')}`);
            if (parts.length > 0) {
                extraRows += `
                    <div style="margin-bottom: 8px;">
                        <span style="color: #6366f1; font-weight: 600; font-size: 13px;">Query Entities:</span>
                        <div style="margin-top: 4px; font-size: 12px; line-height: 1.8;">${parts.join('<br>')}</div>
                    </div>
                `;
            }
        }

        if (filter.groups && filter.groups.length > 0) {
            const groupsHtml = filter.groups.map((group, i) =>
                `<div style="margin-bottom: 4px; font-size: 12px;">
                    <span style="color: #6b7280;">Group ${i + 1}:</span> ${group.map(id => `<code title="${escapeHtml(String(id))}" style="font-size: 11px; padding: 1px 4px; background: #f3f4f6; border-radius: 3px; cursor: default;">${escapeHtml(alias(id))}</code>`).join(' ')}
                </div>`
            ).join('');
            extraRows += `
                <div style="margin-bottom: 8px;">
                    <span style="color: #6366f1; font-weight: 600; font-size: 13px;">Diversity Groups:</span>
                    <div style="margin-top: 4px;">${groupsHtml}</div>
                </div>
            `;
        }

        const summary = `${inputCount} in → ${outputCount} out (${removedCount} removed)`;
        const statusColor = removedCount > 0 ? '#ef4444' : '#10b981';

        const content = `
            ${kvRow('Duration', fmtMs(filter.duration_ms))}
            <div style="margin-bottom: 8px; font-size: 13px;">
                <span style="color: ${statusColor}; font-weight: 600;">${summary}</span>
            </div>
            ${extraRows}
            <div style="margin-bottom: 8px;">
                <div style="font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Input IDs (${inputCount})</div>
                <div style="max-height: 80px; overflow-y: auto;">${renderIdPills(filter.input_ids, colorIn)}</div>
            </div>
            <div style="margin-bottom: 8px;">
                <div style="font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Output IDs (${outputCount})</div>
                <div style="max-height: 80px; overflow-y: auto;">${renderIdPills(filter.output_ids, colorOut)}</div>
            </div>
            ${removedCount > 0 ? `
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 12px; font-weight: 600; color: #ef4444; margin-bottom: 4px;">Removed IDs (${removedCount})</div>
                    <div style="max-height: 80px; overflow-y: auto;">${renderIdPills(filter.removed_ids, colorRemoved)}</div>
                </div>
            ` : ''}
        `;

        const durationLabel = filter.duration_ms != null ? ` — ${fmtMs(filter.duration_ms)}` : '';
        return collapsibleSection(`${name}${durationLabel}`, content, false);
    }

    /**
     * Build the final result section
     */
    function buildFinalResultSection(finalResult) {
        if (!finalResult) return '';
        const sections = Object.entries(finalResult).map(([type, ids]) => {
            const idList = Array.isArray(ids) ? ids : [];
            return `
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 12px; font-weight: 600; color: #6366f1; margin-bottom: 4px;">${type} (${idList.length})</div>
                    ${renderIdPills(idList, '#dbeafe')}
                </div>
            `;
        }).join('');
        return collapsibleSection('Final Results', sections, true);
    }

    /**
     * Build the full trace tab HTML
     */
    function buildTraceTabHTML() {
        const trace = state.lastRecallTrace;
        if (!trace) {
            return `<p style="color: #6b7280; font-size: 14px;">No trace data available. Make sure a recall has been performed with trace enabled.</p>`;
        }

        buildAliasMap(trace);

        const timingBar = buildTimingBarHTML(trace);
        const idLegend = buildIdLegendSection();
        const requestSection = buildTraceRequestSection(trace.request);
        const pineconeSection = buildPineconeSection(trace.pinecone_recall);
        const contentFetchSection = buildContentFetchSection(trace.content_fetch);

        let filterSections = '';
        if (trace.filters) {
            if (trace.filters.date_filter) {
                filterSections += buildFilterSection('Date Filter', trace.filters.date_filter, '#e0e7ff', '#d1fae5', '#fecaca');
            }
            if (trace.filters.entity_filter) {
                filterSections += buildFilterSection('Entity Filter', trace.filters.entity_filter, '#e0e7ff', '#fef3c7', '#fecaca');
            }
            if (trace.filters.llm_proxy_filter) {
                filterSections += buildFilterSection('LLM Proxy Filter', trace.filters.llm_proxy_filter, '#e0e7ff', '#fce7f3', '#fecaca');
            }
            if (trace.filters.diversity_filter) {
                filterSections += buildFilterSection('Diversity Filter', trace.filters.diversity_filter, '#e0e7ff', '#d1fae5', '#fecaca');
            }
        }

        const finalResultSection = buildFinalResultSection(trace.final_result);

        return `
            ${timingBar}
            ${idLegend}
            ${requestSection}
            ${pineconeSection}
            ${contentFetchSection}
            <div style="margin-top: 4px; margin-bottom: 8px; font-size: 15px; font-weight: 700; color: #111;">Filter Pipeline</div>
            ${filterSections}
            ${finalResultSection}
        `;
    }

    // ========================================
    // Transcript Tab
    // ========================================

    function buildTranscriptTabHTML() {
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 12px; color: #6b7280;" id="engramme-transcript-status">Not capturing</span>
                <span style="font-size: 11px; color: #9ca3af;" id="engramme-transcript-length">0 chars</span>
            </div>
            <div id="engramme-transcript-content" style="
                background: #1e1e1e;
                color: #d4d4d4;
                border-radius: 8px;
                padding: 12px 14px;
                font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
                font-size: 12px;
                line-height: 1.6;
                max-height: 400px;
                min-height: 100px;
                overflow-y: auto;
                white-space: pre-wrap;
                word-break: break-word;
            "></div>
            <div id="engramme-transcript-entries" style="
                margin-top: 12px;
                max-height: 200px;
                overflow-y: auto;
                font-size: 12px;
            "></div>
        `;
    }

    function removeInspectorModal(modal) {
        if (!modal) return;
        if (typeof modal.__engrammeCleanup === 'function') {
            modal.__engrammeCleanup();
            modal.__engrammeCleanup = null;
        }
        modal.remove();
    }

    // ========================================
    // Modal
    // ========================================

    /**
     * Show the recall inspector modal with tabbed trace/request/transcript views
     */
    recallInspector.showModal = function() {
        const existingModal = document.getElementById('engramme-recall-inspector-modal');
        if (existingModal) {
            removeInspectorModal(existingModal);
        }

        const modal = document.createElement('div');
        modal.id = 'engramme-recall-inspector-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 900px;
            width: 90%;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        `;

        const hasTrace = !!state.lastRecallTrace;
        const defaultTab = hasTrace ? 'trace' : 'request';

        const tabStyle = (isActive) => `
            padding: 8px 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            background: none;
            color: ${isActive ? '#6366f1' : '#6b7280'};
            border-bottom: 2px solid ${isActive ? '#6366f1' : 'transparent'};
            margin-bottom: -2px;
            transition: color 0.15s, border-color 0.15s;
        `;

        modalContent.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #111;">Recall Inspector</h2>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button id="engramme-debug-memorize-btn" style="
                        background: #6366f1;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        padding: 6px 12px;
                        font-size: 12px;
                        font-weight: 600;
                        cursor: pointer;
                        white-space: nowrap;
                    " title="Send a test memory via skip_extraction bypass">Memorize This Page</button>
                    <button id="engramme-inspector-close-x" style="
                        background: none;
                        border: none;
                        font-size: 20px;
                        cursor: pointer;
                        color: #6b7280;
                        padding: 4px 8px;
                        border-radius: 4px;
                        line-height: 1;
                    " title="Close">&times;</button>
                </div>
            </div>
            <div style="display: flex; gap: 0; margin-bottom: 16px; border-bottom: 2px solid #e5e7eb;">
                <button id="engramme-tab-trace" class="engramme-inspector-tab" style="${tabStyle(defaultTab === 'trace')}">Trace</button>
                <button id="engramme-tab-request" class="engramme-inspector-tab" style="${tabStyle(defaultTab === 'request')}">Request</button>
                <button id="engramme-tab-transcript" class="engramme-inspector-tab" style="${tabStyle(false)}">Live Transcript</button>
            </div>
            <div id="engramme-tab-content-trace" style="display: ${defaultTab === 'trace' ? 'block' : 'none'};">
                ${buildTraceTabHTML()}
            </div>
            <div id="engramme-tab-content-request" style="display: ${defaultTab === 'request' ? 'block' : 'none'};">
                ${buildRequestTabHTML()}
            </div>
            <div id="engramme-tab-content-transcript" style="display: none;">
                ${buildTranscriptTabHTML()}
            </div>
            <button id="engramme-recall-inspector-close" style="
                margin-top: 20px;
                padding: 10px 20px;
                background: #111;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                width: 100%;
                transition: background 0.2s;
            ">Close</button>
        `;

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Tab switching
        const tabs = {
            trace: { btn: document.getElementById('engramme-tab-trace'), content: document.getElementById('engramme-tab-content-trace') },
            request: { btn: document.getElementById('engramme-tab-request'), content: document.getElementById('engramme-tab-content-request') },
            transcript: { btn: document.getElementById('engramme-tab-transcript'), content: document.getElementById('engramme-tab-content-transcript') },
        };

        let transcriptInterval = null;
        let escapeHandler = null;

        function activateTab(name) {
            for (const [key, tab] of Object.entries(tabs)) {
                const isActive = key === name;
                tab.btn.style.color = isActive ? '#6366f1' : '#6b7280';
                tab.btn.style.borderBottom = isActive ? '2px solid #6366f1' : '2px solid transparent';
                tab.content.style.display = isActive ? 'block' : 'none';
            }
            // Stop transcript polling when leaving transcript tab
            if (name !== 'transcript') {
                stopTranscriptRefresh();
            } else {
                refreshTranscript();
                startTranscriptRefresh();
            }
        }

        function refreshTranscript() {
            const gm = window.Engramme?.googleMeets;
            const transcriptContent = document.getElementById('engramme-transcript-content');
            const transcriptStatus = document.getElementById('engramme-transcript-status');
            const transcriptLength = document.getElementById('engramme-transcript-length');
            const transcriptEntries = document.getElementById('engramme-transcript-entries');
            if (!transcriptContent) return;

            if (!gm) {
                transcriptStatus.textContent = 'Google Meets module not loaded';
                transcriptContent.textContent = '';
                return;
            }

            const capturing = gm.isCapturing();
            const accumulated = gm.getAccumulatedTranscript();
            const entries = gm.getTranscript();

            transcriptStatus.textContent = capturing ? 'Capturing...' : 'Not capturing';
            transcriptStatus.style.color = capturing ? '#22c55e' : '#6b7280';
            transcriptLength.textContent = `${accumulated.length} chars`;
            transcriptContent.textContent = accumulated || '(empty - waiting for transcript)';
            transcriptContent.scrollTop = transcriptContent.scrollHeight;

            // Show last 20 transcript buffer entries with speaker labels
            if (entries.length > 0) {
                const recent = entries.slice(-20);
                transcriptEntries.innerHTML = '<div style="font-weight: 600; color: #6366f1; margin-bottom: 6px;">Recent entries (speaker-labeled):</div>' +
                    recent.map(e => {
                        const color = e.speaker === 'You' ? '#3b82f6' : '#f59e0b';
                        return `<div style="padding: 4px 0; border-bottom: 1px solid #f3f4f6;"><span style="color: ${color}; font-weight: 600;">${escapeHtml(e.speaker)}:</span> ${escapeHtml(e.text)}</div>`;
                    }).join('');
            } else {
                transcriptEntries.innerHTML = '';
            }
        }

        function startTranscriptRefresh() {
            if (transcriptInterval) return;
            transcriptInterval = setInterval(refreshTranscript, 1000);
        }

        function stopTranscriptRefresh() {
            if (transcriptInterval) {
                clearInterval(transcriptInterval);
                transcriptInterval = null;
            }
        }

        function cleanupModalResources() {
            stopTranscriptRefresh();
            if (escapeHandler) {
                document.removeEventListener('keydown', escapeHandler);
                escapeHandler = null;
            }
        }

        modal.__engrammeCleanup = cleanupModalResources;

        tabs.trace.btn.addEventListener('click', () => activateTab('trace'));
        tabs.request.btn.addEventListener('click', () => activateTab('request'));
        tabs.transcript.btn.addEventListener('click', () => activateTab('transcript'));

        // Attach collapsible listeners for trace tab
        attachCollapsibleListeners(tabs.trace.content);

        // Debug "Memorize This Page" button
        const memorizeBtn = document.getElementById('engramme-debug-memorize-btn');
        if (memorizeBtn) {
            memorizeBtn.addEventListener('click', async () => {
                memorizeBtn.disabled = true;
                memorizeBtn.textContent = 'Sending...';
                memorizeBtn.style.background = '#9ca3af';
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: 'memorizePageBypass',
                        url: window.location.href,
                        title: document.title,
                        favIconUrl: document.querySelector('link[rel~="icon"]')?.href
                            || document.querySelector('link[rel="shortcut icon"]')?.href
                            || (new URL('/favicon.ico', window.location.origin)).href
                    });
                    if (response?.success) {
                        memorizeBtn.textContent = 'Done!';
                        memorizeBtn.style.background = '#22c55e';
                    } else {
                        memorizeBtn.textContent = 'Failed';
                        memorizeBtn.style.background = '#ef4444';
                        console.error('Bypass memorize failed:', response?.error);
                    }
                } catch (e) {
                    memorizeBtn.textContent = 'Error';
                    memorizeBtn.style.background = '#ef4444';
                    console.error('Bypass memorize error:', e);
                }
                setTimeout(() => {
                    memorizeBtn.disabled = false;
                    memorizeBtn.textContent = 'Memorize This Page';
                    memorizeBtn.style.background = '#6366f1';
                }, 3000);
            });
        }

        function closeModal() {
            cleanupModalResources();
            modal.remove();
        }

        // Close handlers
        document.getElementById('engramme-recall-inspector-close').addEventListener('click', closeModal);
        document.getElementById('engramme-inspector-close-x').addEventListener('click', closeModal);

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
        escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        document.addEventListener('keydown', escapeHandler);
    };

    /**
     * Hide the recall inspector modal if it's open
     */
    recallInspector.hideModal = function() {
        const modal = document.getElementById('engramme-recall-inspector-modal');
        if (modal) {
            removeInspectorModal(modal);
        }
    };

    /**
     * Toggle the recall inspector modal
     */
    recallInspector.toggle = function() {
        const modal = document.getElementById('engramme-recall-inspector-modal');
        if (modal) {
            removeInspectorModal(modal);
        } else {
            recallInspector.showModal();
        }
    };

    // Export recallInspector to namespace (keep 'debug' alias for backward compatibility)
    window.Engramme.recallInspector = recallInspector;
    window.Engramme.debug = recallInspector; // Backward compatibility

})();
