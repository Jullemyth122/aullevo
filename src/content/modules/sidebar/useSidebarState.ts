import { useState, useEffect, useRef, type ChangeEvent } from "react";
import type {
  UserData,
  CustomField,
  SavedFile,
  FormField,
  Memory,
  SavedLink,
} from "../../../types";
import type { Tab, FillStatus } from "./sidebarTypes";
import { migrateCustomFields, createEmptyUserData } from "./sidebarTypes";
import {
  extractFormFields,
  findChatInputField,
  extractChatContext,
  fillChatInputField,
} from "../../../services/formAnalyzer";
import { geminiService } from "../../../services/geminiService";
import { resumeParser } from "../../../services/resumeParser";
import { storageService } from "../../../services/storageService";

let fileUid = 0;
const newFileId = () => `sf-${Date.now()}-${fileUid++}`;

export function useSidebarState() {
  const [isDark, setIsDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("fill");
  const [fieldCount, setFieldCount] = useState(0);
  const [pageFields, setPageFields] = useState<FormField[]>([]);
  const [fillStatus, setFillStatus] = useState<FillStatus>({
    message: "",
    type: "idle",
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [matchingMode, setMatchingMode] = useState<"ai" | "heuristic">(
    "heuristic",
  );
  const [isPro, setIsPro] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [typingDelayMs, setTypingDelayMsState] = useState<number>(0);
  const [skillsInput, setSkillsInput] = useState<string | null>(null);

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Profile management states
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>("Default");
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileType, setNewProfileType] = useState<
    "job" | "medical" | "survey" | "custom"
  >("job");
  const [showNewProfileInput, setShowNewProfileInput] = useState(false);

  const [userData, setUserData] = useState<Partial<UserData>>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    country: "",
    linkedin: "",
    portfolio: "",
    github: "",
    headline: "",
    summary: "",
    skills: [],
    yearsOfExperience: "",
    salaryExpectation: "",
    noticePeriod: "",
    workAuthorization: "",
    dateOfBirth: "",
    gender: "",
    customFields: [],
    experience: [],
    education: [],
  });

  const [apiKey, setApiKey] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [uploadedFile, setUploadedFile] = useState("");
  const [pendingResumeFile, setPendingResumeFile] = useState<File | null>(null);
  const [resumeConsent, setResumeConsent] = useState(false);
  const [resumeParseSuccess, setResumeParseSuccess] = useState(false);
  const [newCFLabel, setNewCFLabel] = useState("");
  const [newCFValue, setNewCFValue] = useState("");
  const [newCFContext, setNewCFContext] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    personal: true,
    filelib: true,
    links: false,
    skills: false,
    job: false,
    custom: true,
    medical_sec: true,
    survey_sec: true,
  });

  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkAutoFill, setNewLinkAutoFill] = useState(true);

  // File Library state
  const [fileLibrary, setFileLibrary] = useState<SavedFile[]>([]);
  const [fileDragging, setFileDragging] = useState(false);
  const fileLibInputRef = useRef<HTMLInputElement>(null);

  const loadFileLibrary = () => {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    chrome.storage.local.get("fileLibrary", (r) => {
      setFileLibrary((r.fileLibrary as SavedFile[]) || []);
    });
  };

  const addFilesToLibrary = async (files: File[]) => {
    if (!isPro && fileLibrary.length + files.length > 2) {
      setFillStatus({
        message:
          "🔒 File Vault is limited to 2 files on the Free tier. Upgrade on our web app!",
        type: "error",
      });
      return;
    }
    const entries: SavedFile[] = [];
    for (const f of files) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(f);
      });
      entries.push({
        id: newFileId(),
        name: f.name,
        size: f.size,
        type: f.type || "application/octet-stream",
        dataUrl,
        savedAt: new Date().toLocaleTimeString("en-US", { hour12: false }),
      });
    }
    const updated = [...fileLibrary, ...entries];

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ fileLibrary: updated }, () => {
        if (chrome.runtime.lastError) {
          console.error("Aullevo Storage Error:", chrome.runtime.lastError);
          setFillStatus({
            message:
              "File too large! Could not save to local storage (Quota exceeded).",
            type: "error",
          });
        } else {
          setFileLibrary(updated);
          setFillStatus({
            message: `Saved ${entries.length} file(s) to library.`,
            type: "success",
          });
          setTimeout(() => setFillStatus({ message: "", type: "idle" }), 3000);
        }
      });
    } else {
      setFileLibrary(updated);
    }
  };

  const removeFromLibrary = (id: string) => {
    const updated = fileLibrary.filter((f) => f.id !== id);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ fileLibrary: updated });
    }
    setFileLibrary(updated);
  };

  // Dark mode listener
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Load profile data
  const loadAllProfileData = async () => {
    try {
      await storageService.migrateLegacyData();
      const list = await storageService.listProfiles();
      const activeName = await storageService.getActiveProfileName();
      const currentActive = list.length ? activeName : "Default";

      setProfiles(list.length ? list : ["Default"]);
      setActiveProfile(currentActive);

      const loaded = await storageService.loadProfile(currentActive);
      if (loaded) {
        loaded.customFields = migrateCustomFields(loaded.customFields);
        setUserData(loaded);
        setSkillsInput((loaded.skills || []).join(", "));
      }
    } catch (err) {
      console.warn("Storage vault load failed, using legacy fallback:", err);
      chrome.storage.local.get(["userData"], (result) => {
        if (result.userData) {
          const loaded = result.userData as UserData;
          loaded.customFields = migrateCustomFields(loaded.customFields);
          setUserData(loaded);
          setSkillsInput((loaded.skills || []).join(", "));
        }
      });
    }
  };

  const handleSwitchProfile = async (name: string) => {
    if (
      !isPro &&
      profiles.length > 1 &&
      name !== profiles[0] &&
      name !== "Default"
    ) {
      setSaveMsg("🔒 Profile switching is a Pro feature!");
      setTimeout(() => setSaveMsg(""), 3000);
      return;
    }
    await storageService.setActiveProfileName(name);
    const data = await storageService.loadProfile(name);
    if (data) {
      chrome.storage.local.set({ userData: data });
      data.customFields = migrateCustomFields(data.customFields);
      setUserData(data);
      setSkillsInput((data.skills || []).join(", "));
    } else {
      const emptyData = createEmptyUserData();
      chrome.storage.local.set({ userData: emptyData });
      setUserData(emptyData);
      setSkillsInput("");
    }
    setActiveProfile(name);
    setSaveMsg("Switched profile!");
    setTimeout(() => setSaveMsg(""), 2000);
  };

  const handleCreateProfile = async () => {
    if (!isPro && profiles.length >= 1) {
      setSaveMsg("🔒 Profile limit (1) reached. Upgrade on web app!");
      setTimeout(() => setSaveMsg(""), 4000);
      return;
    }
    const name = newProfileName.trim();
    if (!name) return;
    if (profiles.includes(name)) {
      setSaveMsg("Profile exists!");
      setTimeout(() => setSaveMsg(""), 2000);
      return;
    }

    const emptyData = createEmptyUserData(newProfileType);
    await storageService.saveProfile(name, emptyData);
    setNewProfileName("");
    setNewProfileType("job");
    setShowNewProfileInput(false);
    await loadAllProfileData();
    await handleSwitchProfile(name);
  };

  const handleDeleteProfile = async (name: string) => {
    if (profiles.length <= 1) {
      setSaveMsg("Cannot delete last profile");
      setTimeout(() => setSaveMsg(""), 2000);
      return;
    }
    if (!confirm(`Are you sure you want to delete profile "${name}"?`)) return;

    await storageService.deleteProfile(name);
    const nextActive = profiles.find((p) => p !== name) || "Default";
    await loadAllProfileData();
    await handleSwitchProfile(nextActive);
    setSaveMsg("Profile deleted");
    setTimeout(() => setSaveMsg(""), 2000);
  };

  // Load settings from storage on mount
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    chrome.storage.local.get(
      [
        "geminiApiKey",
        "matchingMode",
        "isPro",
        "autoSubmit",
        "typingDelayMs",
        "stealthMode",
      ],
      (result) => {
        if (result.geminiApiKey) setApiKey(result.geminiApiKey as string);
        if (result.matchingMode)
          setMatchingMode(result.matchingMode as "ai" | "heuristic");
        if (result.isPro !== undefined) setIsPro(!!result.isPro);
        if (result.autoSubmit !== undefined) setAutoSubmit(!!result.autoSubmit);
        if (result.typingDelayMs !== undefined) {
          setTypingDelayMsState(Number(result.typingDelayMs));
        } else if (result.stealthMode) {
          setTypingDelayMsState(25);
        }
      },
    );
    loadAllProfileData();
    loadFileLibrary();

    const storageListener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName === "local") {
        if (changes.isPro !== undefined) {
          setIsPro(!!changes.isPro.newValue);
        }
        if (changes.typingDelayMs !== undefined) {
          setTypingDelayMsState(Number(changes.typingDelayMs.newValue || 0));
        }
        if (changes.userUid !== undefined || changes.userEmail !== undefined) {
          if (
            changes.userUid?.newValue !== changes.userUid?.oldValue ||
            changes.userEmail?.newValue !== changes.userEmail?.oldValue
          ) {
            loadAllProfileData();
            loadFileLibrary();
          }
        }
        if (changes.userData && changes.userData.newValue) {
          const loaded = changes.userData.newValue as UserData;
          loaded.customFields = migrateCustomFields(loaded.customFields);
          setUserData((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(loaded)) return prev;
            return loaded;
          });
          setSkillsInput((loaded.skills || []).join(", "));
        }
        if (changes.fileLibrary && changes.fileLibrary.newValue) {
          setFileLibrary((changes.fileLibrary.newValue as SavedFile[]) || []);
        }
      }
    };
    chrome.storage.onChanged.addListener(storageListener);
    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  const scanFields = () => {
    try {
      const fields = extractFormFields();
      setFieldCount(fields.length);
      setPageFields(fields);
    } catch {
      setFieldCount(0);
      setPageFields([]);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === "fill") scanFields();
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen || activeTab !== "fill") return;
    const observer = new MutationObserver(() => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = setTimeout(scanFields, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [isOpen, activeTab]);

  useEffect(() => {
    const handleMessage = (
      request: {
        action?: string;
        message?: string;
        statusType?:
          | "idle"
          | "scanning"
          | "filling"
          | "success"
          | "error"
          | "info";
      },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (request.action === "toggleSidebar") {
        setIsOpen((p) => !p);
        sendResponse({ success: true });
      }
      if (request.action === "openSidebar") {
        setIsOpen(true);
        sendResponse({ success: true });
      }
      if (request.action === "sidebarStatus") {
        setFillStatus({
          message: request.message || "",
          type: request.statusType || "idle",
        });
        if (
          request.statusType === "scanning" ||
          request.statusType === "filling"
        ) {
          setIsProcessing(true);
          setActiveTab("fill");
        } else {
          setIsProcessing(false);
          if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
        }
      }
    };
    if (typeof chrome !== "undefined")
      chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      if (typeof chrome !== "undefined")
        chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrlShiftE =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "e" || e.key === "E");
      const isAltShortcut =
        e.altKey &&
        (e.key === "e" ||
          e.key === "E" ||
          e.key === "a" ||
          e.key === "A" ||
          e.key === "t" ||
          e.key === "T");
      const isAltShift =
        e.altKey &&
        e.shiftKey &&
        (e.key === "e" ||
          e.key === "E" ||
          e.key === "a" ||
          e.key === "A" ||
          e.key === "s" ||
          e.key === "S");

      if (isCtrlShiftE || isAltShortcut || isAltShift) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen((p) => !p);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  const toggleSection = (key: string) =>
    setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  const handleInput = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setUserData((p) => ({ ...p, [name]: value }));
  };

  const handleSave = async (extraCustomField?: CustomField | unknown) => {
    let dataToSave = { ...userData };
    if (
      extraCustomField &&
      typeof extraCustomField === "object" &&
      ("label" in extraCustomField || "value" in extraCustomField)
    ) {
      const cf = extraCustomField as CustomField;
      if (cf.label || cf.value) {
        const updatedCFs = [
          ...((dataToSave.customFields as CustomField[]) || []),
          cf,
        ];
        dataToSave = { ...dataToSave, customFields: updatedCFs };
        setUserData(dataToSave);
      }
    }
    if (typeof chrome !== "undefined" && chrome?.storage) {
      try {
        await storageService.saveProfile(activeProfile, dataToSave as UserData);
        setSaveMsg("Saved!");
        setTimeout(() => setSaveMsg(""), 2000);
      } catch (err: unknown) {
        console.error("Save error:", err);
        chrome.storage.local.set({ userData: dataToSave }, () => {
          setSaveMsg("Saved (fallback)!");
          setTimeout(() => setSaveMsg(""), 2000);
        });
      }
    }
  };

  const handleSaveApiKey = () => {
    if (typeof chrome !== "undefined" && chrome?.storage) {
      const trimmedKey = apiKey.trim();
      chrome.storage.local.set({ geminiApiKey: trimmedKey }, () => {
        setSaveMsg("API key saved!");
        setTimeout(() => setSaveMsg(""), 2000);
      });
    }
  };

  const addCustomField = (customFieldOrLabel?: CustomField | string) => {
    let cf: CustomField;
    if (typeof customFieldOrLabel === "object" && customFieldOrLabel !== null) {
      cf = customFieldOrLabel;
    } else {
      const label = (
        typeof customFieldOrLabel === "string" ? customFieldOrLabel : newCFLabel
      ).trim();
      const val = newCFValue.trim();
      const ctx = newCFContext.trim();
      if (!label && !val) return;
      cf = { label: label || val || "Custom Field", value: val, context: ctx };
    }
    setUserData((p) => {
      const updated = {
        ...p,
        customFields: [...((p.customFields as CustomField[]) || []), cf],
      };
      if (typeof chrome !== "undefined" && chrome?.storage) {
        storageService
          .saveProfile(activeProfile, updated as UserData)
          .catch(() => {
            chrome.storage.local.set({ userData: updated });
          });
      }
      return updated;
    });
    setNewCFLabel("");
    setNewCFValue("");
    setNewCFContext("");
  };

  const removeCustomField = (i: number) => {
    setUserData((p) => {
      const updated = {
        ...p,
        customFields: ((p.customFields as CustomField[]) || []).filter(
          (_, idx) => idx !== i,
        ),
      };
      if (typeof chrome !== "undefined" && chrome?.storage) {
        storageService
          .saveProfile(activeProfile, updated as UserData)
          .catch(() => {
            chrome.storage.local.set({ userData: updated });
          });
      }
      return updated;
    });
  };

  const addMemory = () => {
    if (!isPro && (userData.memories || []).length >= 2) {
      setFillStatus({
        message:
          "🔒 Memories are limited to 2 on the Free tier. Upgrade on our web app!",
        type: "error",
      });
      return;
    }
    if (!newMemTitle.trim() || !newMemContent.trim()) return;
    const memory: Memory = {
      id: Date.now().toString(),
      title: newMemTitle.trim(),
      content: newMemContent.trim(),
    };
    setUserData((p) => {
      const updated = {
        ...p,
        memories: [...((p.memories as Memory[]) || []), memory],
      };
      if (typeof chrome !== "undefined" && chrome?.storage) {
        chrome.storage.local.set({ userData: updated });
        storageService
          .saveProfile(activeProfile, updated as UserData)
          .catch(() => {});
      }
      return updated;
    });
    setNewMemTitle("");
    setNewMemContent("");
  };

  const removeMemory = (id: string) => {
    setUserData((p) => {
      const updated = {
        ...p,
        memories: ((p.memories as Memory[]) || []).filter((m) => m.id !== id),
      };
      if (typeof chrome !== "undefined" && chrome?.storage) {
        chrome.storage.local.set({ userData: updated });
        storageService
          .saveProfile(activeProfile, updated as UserData)
          .catch(() => {});
      }
      return updated;
    });
  };

  const addLink = () => {
    if (!isPro && (userData.savedLinks || []).length >= 2) {
      setFillStatus({
        message:
          "🔒 Links are limited to 2 on the Free tier. Upgrade on our web app!",
        type: "error",
      });
      return;
    }
    if (!newLinkTitle.trim() || !newLinkUrl.trim()) return;
    const link: SavedLink = {
      id: Date.now().toString(),
      title: newLinkTitle.trim(),
      url: newLinkUrl.trim(),
      autoFill: newLinkAutoFill,
    };
    setUserData((p) => {
      const updated = {
        ...p,
        savedLinks: [...((p.savedLinks as SavedLink[]) || []), link],
      };
      if (typeof chrome !== "undefined" && chrome?.storage) {
        chrome.storage.local.set({ userData: updated });
        storageService
          .saveProfile(activeProfile, updated as UserData)
          .catch(() => {});
      }
      return updated;
    });
    setNewLinkTitle("");
    setNewLinkUrl("");
    setNewLinkAutoFill(true);
  };

  const removeLink = (id: string) => {
    setUserData((p) => {
      const updated = {
        ...p,
        savedLinks: ((p.savedLinks as SavedLink[]) || []).filter(
          (l) => l.id !== id,
        ),
      };
      if (typeof chrome !== "undefined" && chrome?.storage) {
        chrome.storage.local.set({ userData: updated });
        storageService
          .saveProfile(activeProfile, updated as UserData)
          .catch(() => {});
      }
      return updated;
    });
  };

  const triggerAutopilot = (url: string) => {
    if (typeof chrome !== "undefined") {
      chrome.runtime.sendMessage({ action: "openAutopilotLink", url });
    }
    setIsOpen(false);
  };

  const handleSelectResumeFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingResumeFile(file);
    setResumeConsent(false);
    setResumeParseSuccess(false);
    e.target.value = "";
  };

  const handleCancelResumeParse = () => {
    setPendingResumeFile(null);
    setResumeConsent(false);
  };

  const dismissParseSuccess = () => {
    setResumeParseSuccess(false);
  };

  const handleConfirmResumeParse = async () => {
    if (!pendingResumeFile) return;
    if (!apiKey) {
      setFillStatus({
        message: "Please add your Gemini API key in Settings first.",
        type: "error",
      });
      setActiveTab("settings");
      return;
    }
    const file = pendingResumeFile;
    setUploadedFile(file.name);
    setIsProcessing(true);
    setFillStatus({
      message: "Extracting text and parsing with Gemini AI…",
      type: "info",
    });
    try {
      geminiService.setApiKey(apiKey);
      const text = await resumeParser.parseFile(file);
      const parsed = await geminiService.parseResume(text);
      const merged = {
        ...userData,
        ...parsed,
        customFields: userData.customFields || [],
      };
      setUserData(merged);

      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        if (typeof chrome !== "undefined" && chrome?.storage) {
          chrome.storage.local.set({
            userData: merged,
            resumeFileData: base64,
            resumeFileName: file.name,
          });
        }
      };
      reader.readAsDataURL(file);

      setPendingResumeFile(null);
      setResumeParseSuccess(true);
      setFillStatus({
        message: "Resume parsed! Please review all fields in the Profile tab.",
        type: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFillStatus({
        message: msg || "Failed to parse resume.",
        type: "error",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFill = async () => {
    if (matchingMode === "ai" && !isPro) {
      setFillStatus({
        message: "🔒 Gemini AI matching is a Pro feature. Please upgrade!",
        type: "error",
      });
      return;
    }
    if (matchingMode === "ai" && !apiKey) {
      setFillStatus({
        message: "Add your Gemini API key in Settings first.",
        type: "error",
      });
      setActiveTab("settings");
      return;
    }
    setIsProcessing(true);
    setActiveTab("fill");

    // Ensure current in-memory userData is persisted to storage before triggering fill
    if (typeof chrome !== "undefined" && chrome?.storage) {
      chrome.storage.local.set({ userData });
      storageService
        .saveProfile(activeProfile, userData as UserData)
        .catch(() => {});
    }

    const chatInput = findChatInputField();
    if (chatInput && matchingMode === "ai") {
      setFillStatus({
        message: "Chat window detected. Gathering context...",
        type: "scanning",
      });
      try {
        const conversationHistory = extractChatContext(chatInput);
        setFillStatus({
          message: "Constructing AI reply...",
          type: "scanning",
        });

        chrome.runtime.sendMessage(
          {
            action: "processChatAI",
            conversationHistory,
          },
          (response) => {
            if (response?.success && response.replyText) {
              const injectionSuccess = fillChatInputField(
                chatInput,
                response.replyText,
              );
              if (injectionSuccess) {
                setFillStatus({
                  message: "Reply injected successfully!",
                  type: "success",
                });
              } else {
                setFillStatus({
                  message: "Generated reply, but failed to inject into DOM.",
                  type: "error",
                });
              }
            } else {
              setFillStatus({
                message: response?.error || "Failed to generate reply.",
                type: "error",
              });
            }
            setIsProcessing(false);
          },
        );
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setFillStatus({ message: msg, type: "error" });
        setIsProcessing(false);
        return;
      }
    }

    if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
    fillTimeoutRef.current = setTimeout(() => {
      setIsProcessing(false);
      setFillStatus({
        message: "Filling safety timeout. Try again or switch to Keyword mode.",
        type: "error",
      });
    }, 90000);

    setFillStatus({
      message:
        matchingMode === "heuristic"
          ? "Matching fields by keyword…"
          : "Scanning form fields…",
      type: "scanning",
    });
    try {
      chrome.runtime.sendMessage(
        { action: "triggerFillFromSidebar", data: { userData } },
        (response) => {
          if (chrome.runtime?.lastError) {
            console.warn(
              "Aullevo: Extension context error (safe to ignore)",
              chrome.runtime.lastError,
            );
            setFillStatus({
              message: "Extension reloaded. Please refresh the page.",
              type: "error",
            });
            setIsProcessing(false);
            if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
            return;
          }
          if (response?.success) {
            // Handled via sidebarStatus
          } else {
            setFillStatus({
              message: response?.error || "Fill failed",
              type: "error",
            });
            setIsProcessing(false);
            if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
          }
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFillStatus({ message: msg, type: "error" });
      setIsProcessing(false);
      if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
    }
  };

  const setTypingDelayMs = (ms: number) => {
    const validMs = Math.max(0, Math.min(1000, Number(ms) || 0));
    setTypingDelayMsState(validMs);
    if (typeof chrome !== "undefined" && chrome?.storage) {
      chrome.storage.local.set({
        typingDelayMs: validMs,
        stealthMode: validMs > 0,
      });
    }
  };

  const handleSetActiveTab = (tab: Tab) => {
    if (isProcessing && tab !== "fill") return;
    setActiveTab(tab);
  };

  return {
    isDark,
    setIsDark,
    isOpen,
    setIsOpen,
    activeTab,
    setActiveTab: handleSetActiveTab,
    fieldCount,
    pageFields,
    scanFields,
    fillStatus,
    setFillStatus,
    isProcessing,
    matchingMode,
    setMatchingMode,
    isPro,
    autoSubmit,
    setAutoSubmit,
    typingDelayMs,
    setTypingDelayMs,
    skillsInput,
    setSkillsInput,
    profiles,
    activeProfile,
    handleSwitchProfile,
    newProfileName,
    setNewProfileName,
    newProfileType,
    setNewProfileType,
    showNewProfileInput,
    setShowNewProfileInput,
    handleCreateProfile,
    handleDeleteProfile,
    userData,
    setUserData,
    handleInput,
    handleSave,
    apiKey,
    setApiKey,
    handleSaveApiKey,
    saveMsg,
    uploadedFile,
    pendingResumeFile,
    resumeConsent,
    setResumeConsent,
    resumeParseSuccess,
    dismissParseSuccess,
    handleResumeUpload: handleSelectResumeFile,
    handleSelectResumeFile,
    handleConfirmResumeParse,
    handleCancelResumeParse,
    handleFill,
    openSections,
    toggleSection,
    newCFLabel,
    setNewCFLabel,
    newCFValue,
    setNewCFValue,
    newCFContext,
    setNewCFContext,
    addCustomField,
    removeCustomField,
    newMemTitle,
    setNewMemTitle,
    newMemContent,
    setNewMemContent,
    addMemory,
    removeMemory,
    newLinkTitle,
    setNewLinkTitle,
    newLinkUrl,
    setNewLinkUrl,
    newLinkAutoFill,
    setNewLinkAutoFill,
    addLink,
    removeLink,
    triggerAutopilot,
    fileLibrary,
    fileDragging,
    setFileDragging,
    fileLibInputRef,
    addFilesToLibrary,
    removeFromLibrary,
  };
}

export type SidebarState = ReturnType<typeof useSidebarState>;
