import React, { useState, useEffect, useRef } from 'react';
import { Code2, X, Copy, Upload, Download, Maximize2, Minimize2, Check, AlignLeft, Crown } from 'lucide-react';
import type { CM } from '../types';
import './jsonmodal.scss';

interface JsonConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    fields: CM[];
    onImport: (importedFields: CM[]) => void;
    isPro: boolean;
    profileName: string;
}

export const JsonConfigModal: React.FC<JsonConfigModalProps> = ({
    isOpen,
    onClose,
    fields,
    onImport,
    isPro,
    profileName
}) => {
    const [jsonText, setJsonText] = useState<string>('');
    const [fieldCount, setFieldCount] = useState<number>(0);
    const [parseError, setParseError] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [copied, setCopied] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Sync JSON text when modal opens (filters out any garbage fields automatically)
    useEffect(() => {
        if (isOpen) {
            const cleanFields = fields.filter(f => f && f.label && !["id", "label", "value", "enabled", "context", "content"].includes(f.label.toLowerCase().trim()));
            const formatted = JSON.stringify(cleanFields, null, 2);
            setJsonText(formatted);
            setFieldCount(cleanFields.length);
            setParseError(null);
            setCopied(false);
        }
    }, [isOpen, fields]);


    // Live validation & field counter as you type
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        setJsonText(text);
        if (!text.trim()) {
            setFieldCount(0);
            setParseError(null);
            return;
        }
        try {
            const parsed = JSON.parse(text);
            const count = Array.isArray(parsed)
                ? parsed.length
                : (typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).length : 0);
            setFieldCount(count);
            setParseError(null);
        } catch (err: any) {
            setParseError(err.message);
        }
    };

    // Beautify / Format JSON
    const handleFormatJson = () => {
        try {
            const parsed = JSON.parse(jsonText);
            setJsonText(JSON.stringify(parsed, null, 2));
            setParseError(null);
        } catch (err: any) {
            setParseError(err.message);
        }
    };

    // Copy to clipboard
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(jsonText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { }
    };

    // Download current JSON as a .json file (backup / export)
    const handleDownload = () => {
        const safeName = profileName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
        const blob = new Blob([jsonText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `aullevo-${safeName}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // Upload .json file from disk
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            setJsonText(content);
            try {
                const parsed = JSON.parse(content);
                const count = Array.isArray(parsed) ? parsed.length : (typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).length : 0);
                setFieldCount(count);
                setParseError(null);
            } catch (err: any) {
                setParseError(err.message);
            }
        };
        reader.readAsText(file);
    };

    // Universal JSON Parser (handles arrays, key-values, and nested dicts from injectToGoogle)
    const parseAnyJsonToFields = (rawInput: string): CM[] => {
        const data = JSON.parse(rawInput);
        const result: CM[] = [];
        const seenLabels = new Set<string>();
        const RESERVED = new Set(["id", "label", "value", "enabled", "context", "content"]);

        const addField = (label: string, value: any, context: string = '', id?: string, group?: string) => {
            if (!label || value === null || value === undefined) return;
            const cleanL = String(label).trim();
            const cleanV = String(value).trim();
            const lowerL = cleanL.toLowerCase();
            if (!cleanL || RESERVED.has(lowerL)) return;
            if (seenLabels.has(lowerL)) return;
            seenLabels.add(lowerL);
            result.push({
                id: id || `cf_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                label: cleanL,
                value: cleanV,
                enabled: true,
                context: context || cleanL,
                isSensitive: false,
                group: group?.trim() || 'Custom Fields' // Defaults to Custom Fields if not mentioned!
            });
        };


        if (Array.isArray(data)) {
            data.forEach((item) => {
                if (Array.isArray(item) && item.length >= 2) {
                    addField(item[0], item[1]);
                } else if (typeof item === 'object' && item !== null) {
                    const label = item.label || item.key || item.name || item.title || item.field;
                    const value = item.value ?? item.val ?? item.text ?? '';
                    const context = item.context || '';
                    const id = item.id || undefined;
                    const group = item.group || undefined;

                    if (label) {
                        addField(label, value, context, id, group);
                    } else {
                        for (const [k, v] of Object.entries(item)) {
                            if (typeof v !== 'object') addField(k, v);
                        }
                    }
                }
            });
        } else if (typeof data === 'object' && data !== null) {
            for (const [k, v] of Object.entries(data)) {
                if (typeof v !== 'object') {
                    addField(k, v);
                }
            }
        }

        return result;
    };

    const handleImport = () => {
        try {
            const imported = parseAnyJsonToFields(jsonText);
            if (imported.length === 0) {
                alert("No valid fields found in the provided JSON.");
                return;
            }
            onImport(imported);
            onClose();
        } catch (err: any) {
            alert("Invalid JSON format: " + err.message);
        }
    };

    if (!isOpen) return null;

    return (
        <div className={`av-modal-backdrop ${isOpen ? 'open' : ''} ${isFullscreen ? 'fullscreen' : ''}`}>
            <div className={`av-modal-card ${isFullscreen ? 'fullscreen' : ''}`}>
                {/* Header */}
                <div className="av-modal-header">
                    <div className="av-modal-title-group">
                        <div className="av-modal-title">
                            <Code2 size={15} />
                            <span>JSON Configuration</span>
                        </div>
                        <span className={`av-badge-json ${parseError ? 'error' : ''}`}>
                            {parseError ? 'Invalid JSON' : `✓ ${fieldCount} fields`}
                        </span>
                    </div>

                    <div className="av-modal-actions">
                        <button
                            type="button"
                            className="av-btn-subtle"
                            onClick={handleFormatJson}
                            title="Format / Beautify JSON"
                        >
                            <AlignLeft size={13} />
                        </button>
                        <button
                            type="button"
                            className="av-btn-subtle"
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        >
                            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                        </button>
                        <button
                            type="button"
                            className="av-btn-subtle"
                            onClick={onClose}
                            title="Close"
                        >
                            <X size={13} />
                        </button>
                    </div>
                </div>

                {/* Editor Area */}
                <textarea
                    className="av-json-textarea"
                    value={jsonText}
                    onChange={handleTextChange}
                    spellCheck={false}
                    placeholder={`[\n  {\n    "label": "Question Label",\n    "value": "Answer Value",\n    "enabled": true\n  }\n]`}
                />

                {!isPro && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '6px 10px', color: '#eab308' }}>
                        <Crown size={12} />
                        <span>JSON import & export are Pro features. You can view your fields here.</span>
                    </div>
                )}

                {/* Footer */}
                <div className="av-modal-footer">
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="av-btn-secondary" onClick={handleDownload} disabled={!isPro || Boolean(parseError)}>
                            <Download size={12} />
                            <span>Download</span>
                        </button>
                        <button type="button" className="av-btn-secondary" onClick={handleCopy} disabled={!isPro}>
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                        </button>

                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            accept=".json"
                            style={{ display: 'none' }}
                        />
                        <button
                            type="button"
                            className="av-btn-secondary"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!isPro}
                        >
                            <Upload size={12} />
                            <span>Upload File</span>
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="av-btn-primary" onClick={handleImport} disabled={!isPro}>
                            Import
                        </button>
                        <button type="button" className="av-btn-cancel" onClick={onClose}>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
