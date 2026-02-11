import { useState, useEffect, type ChangeEvent } from 'react';
import { Upload, Save, Sparkles, Loader2 } from 'lucide-react';
import { geminiService } from '../services/geminiService';
import { resumeParser } from '../services/resumeParser';
import type { UserData, Status, ChromeResponse } from '../types';
import './Popup.css';

function Popup() {
    const [userData, setUserData] = useState<Partial<UserData>>({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
        linkedin: '',
        portfolio: '',
        github: '',
        skills: [],
        summary: '',
        experience: [],
        education: []
    });

    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [status, setStatus] = useState<Status>({ message: '', type: '' });
    const [uploadedFileName, setUploadedFileName] = useState<string>('');

    const [apiKey, setApiKey] = useState<string>('');
    const [showSettings, setShowSettings] = useState<boolean>(false);

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.get(['userData', 'geminiApiKey'], (result) => {
                if (result?.userData) {
                    setUserData(result.userData as Partial<UserData>);
                }
                if (result?.geminiApiKey) {
                    setApiKey(result.geminiApiKey as string);
                }
            });
        }
    }, []);

    const handleResumeUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadedFileName(file.name);
        setIsProcessing(true);
        setStatus({ message: '🤖 Gemini AI is parsing your resume...', type: 'info' });

        try {
            // Check for API key presence
            if (!apiKey && !(import.meta as any).env.VITE_GEMINI_API_KEY) {
                throw new Error("Please set your Gemini API Key in Settings first.");
            }

            // Update service key if we have one in state
            if (apiKey) {
                geminiService.setApiKey(apiKey);
            }

            const resumeText = await resumeParser.parseFile(file);
            const parsedData = await geminiService.parseResume(resumeText);

            const newData = { ...userData, ...parsedData };
            setUserData(newData);

            setStatus({
                message: '✅ Resume parsed successfully by Gemini!',
                type: 'success'
            });

            if (typeof chrome !== 'undefined' && chrome?.storage) {
                chrome.storage.local.set({ userData: newData });
            }

        } catch (error: any) {
            console.error(error);
            setStatus({
                message: `❌ ${error.message || 'Error parsing resume'}`,
                type: 'error'
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setUserData({
            ...userData,
            [name]: value
        });
    };

    const handleSave = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData }, () => {
                setStatus({ message: '💾 Data saved!', type: 'success' });
                setTimeout(() => setStatus({ message: '', type: '' }), 2000);
            });
        } else {
            setStatus({ message: '💾 Data saved! (mocked in dev preview)', type: 'success' });
            setTimeout(() => setStatus({ message: '', type: '' }), 2000);
        }
    };

    const handleAIFillForm = async () => {
        setIsProcessing(true);
        setStatus({ message: '🤖 Gemini is analyzing the form...', type: 'info' });

        if (typeof chrome === 'undefined' || !chrome.tabs) {
            setStatus({
                message: '⚠️ Form filling only works in real extension',
                type: 'error'
            });
            setIsProcessing(false);
            return;
        }

        try {
            // Check for API key presence
            if (!apiKey && !(import.meta as any).env.VITE_GEMINI_API_KEY) {
                throw new Error("Please set your Gemini API Key in Settings first.");
            }

            // Update service key if we have one in state
            if (apiKey) {
                geminiService.setApiKey(apiKey);
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab.id) throw new Error("No active tab found");

            chrome.tabs.sendMessage(
                tab.id,
                { action: 'analyzeForm' },
                async (response: ChromeResponse) => {
                    if (chrome.runtime.lastError) {
                        setStatus({ message: '❌ Refresh the page and try again.', type: 'error' });
                        setIsProcessing(false);
                        return;
                    }

                    if (!response?.success) {
                        setStatus({ message: '❌ No form found on this page', type: 'error' });
                        setIsProcessing(false);
                        return;
                    }

                    const { fields } = response;
                    try {
                        const fieldMappings = await geminiService.analyzeFormFields(fields!);

                        chrome.tabs.sendMessage(
                            tab.id!,
                            {
                                action: 'fillForm',
                                data: { fieldMappings, userData }
                            },
                            (fillResponse: ChromeResponse) => {
                                if (fillResponse?.success) {
                                    setStatus({
                                        message: `✅ Filled ${fillResponse.filledCount}/${fillResponse.total} fields!`,
                                        type: 'success'
                                    });
                                }
                                setIsProcessing(false);
                            }
                        );
                    } catch (err) {
                        console.error(err);
                        setStatus({ message: '❌ AI Analysis failed', type: 'error' });
                        setIsProcessing(false);
                    }
                }
            );
        } catch (error: any) {
            console.error(error);
            setStatus({ message: `❌ ${error.message || 'Error filling form'}`, type: 'error' });
            setIsProcessing(false);
        }
    };

    const saveApiKey = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
                setStatus({ message: '🔑 API Key saved!', type: 'success' });
                setTimeout(() => setStatus({ message: '', type: '' }), 2000);
            });
        }
    };

    return (
        <div className="popup-container">
            <header className="header">
                <h1>🚗 Aullevo</h1>
                <button
                    className="settings-btn"
                    onClick={() => setShowSettings(!showSettings)}
                    title="Settings"
                >
                    ⚙️
                </button>
            </header>

            {showSettings ? (
                <div className="settings-section">
                    <h3>Settings</h3>
                    <div className="input-group">
                        <label>Gemini API Key</label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Enter Gemini API Key"
                        />
                        <button onClick={saveApiKey} className="save-btn small">Save Key</button>
                    </div>
                </div>
            ) : (
                <>
                    <p className="tagline">AI-Powered Form Filler by Gemini</p>

                    <div className="upload-section">
                        <label className="upload-btn">
                            <Upload size={18} />
                            {uploadedFileName || 'Upload Resume (PDF/DOCX)'}
                            <input
                                type="file"
                                accept=".pdf,.docx,.doc,.txt"
                                onChange={handleResumeUpload}
                                disabled={isProcessing}
                                hidden
                            />
                        </label>
                    </div>

                    <div className="form-section">
                        <div className="form-row">
                            <input
                                type="text"
                                name="firstName"
                                placeholder="First Name"
                                value={userData.firstName || ''}
                                onChange={handleInputChange}
                            />
                            <input
                                type="text"
                                name="lastName"
                                placeholder="Last Name"
                                value={userData.lastName || ''}
                                onChange={handleInputChange}
                            />
                        </div>

                        <input
                            type="email"
                            name="email"
                            placeholder="Email"
                            value={userData.email || ''}
                            onChange={handleInputChange}
                        />

                        <input
                            type="tel"
                            name="phone"
                            placeholder="Phone Number"
                            value={userData.phone || ''}
                            onChange={handleInputChange}
                        />

                        <input
                            type="text"
                            name="address"
                            placeholder="Street Address"
                            value={userData.address || ''}
                            onChange={handleInputChange}
                        />

                        <div className="form-row">
                            <input
                                type="text"
                                name="city"
                                placeholder="City"
                                value={userData.city || ''}
                                onChange={handleInputChange}
                            />
                            <input
                                type="text"
                                name="state"
                                placeholder="State"
                                value={userData.state || ''}
                                onChange={handleInputChange}
                            />
                        </div>

                        <input
                            type="url"
                            name="linkedin"
                            placeholder="LinkedIn URL"
                            value={userData.linkedin || ''}
                            onChange={handleInputChange}
                        />

                        <textarea
                            name="summary"
                            placeholder="Professional Summary"
                            value={userData.summary || ''}
                            onChange={handleInputChange}
                            rows={3}
                        />
                    </div>

                    <button className="save-btn" onClick={handleSave} disabled={isProcessing}>
                        <Save size={18} />
                        Save Data
                    </button>

                    <button
                        className="fill-btn"
                        onClick={handleAIFillForm}
                        disabled={isProcessing}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 size={18} className="spinning" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Sparkles size={18} />
                                Gemini AI Fill Form
                            </>
                        )}
                    </button>
                </>
            )}

            {status.message && (
                <div className={`status status-${status.type}`}>
                    {status.message}
                </div>
            )}

            <footer className="footer">
                <small>Powered by Gemini 2.5 Flash</small>
            </footer>
        </div>
    );
}

export default Popup;