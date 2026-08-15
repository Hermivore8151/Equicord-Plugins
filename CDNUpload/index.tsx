import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { insertTextIntoChatInputBox } from "@utils/discord"; 
import { 
    React,
    ChannelStore, 
    GuildStore, 
    PermissionStore, 
    SelectedChannelStore, 
    UserStore,
    MessageActions,
    MessageStore,
    PermissionsBits
} from "@webpack/common";

// Icons
function CdnEnabledIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
    );
}

function CdnDisabledIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
    );
}

// States
type UploadStatus = "idle" | "uploading" | "success" | "error";
interface UploadState { status: UploadStatus; progress: number; enabled: boolean; }

let currentState: UploadState = { status: "idle", progress: 0, enabled: true };
const stateListeners = new Set<(state: UploadState) => void>();

function updateState(newState: Partial<UploadState>) {
    currentState = { ...currentState, ...newState };
    stateListeners.forEach(listener => listener(currentState));
}

function useUploadState(): UploadState {
    const [state, setState] = React.useState<UploadState>(currentState);
    React.useEffect(() => {
        const listener = (s: UploadState) => setState(s);
        stateListeners.add(listener);
        return () => { stateListeners.delete(listener); };
    }, []);
    return state;
}

// Settings
const settings = definePluginSettings({
    alwaysUseCdn: {
        type: OptionType.BOOLEAN,
        description: "Internal state for the chatbar button toggle.",
        default: true,
        hidden: true
    },
    uploadMode: {
        type: OptionType.SELECT,
        description: "How to handle message sending during CDN uploads",
        options: [
            { label: "Inject URL immediately (Default)", value: "inject", default: true },
            { label: "Block sending until complete", value: "block" },
            { label: "Placeholder & edit after send", value: "edit" }
        ],
        default: "inject"
    },
    editModeMinSizeMB: {
        type: OptionType.NUMBER,
        description: "Minimum file size (in MB) to use the placeholder method. Smaller files inject immediately.",
        default: 0,
    },
    editModeShowProgress: {
        type: OptionType.BOOLEAN,
        description: "Update the sent message with upload progress.",
        default: true,
    },
    editModeProgressDelay: {
        type: OptionType.NUMBER,
        description: "Delay in ms between progress updates. WARNING: Setting below 1500ms may cause Discord API rate limits!",
        default: 1500,
    },
    cdnUrl: {
        type: OptionType.STRING,
        description: "The base CDN URL to PUT files to (must end in /)",
        default: "https://hermivore.cat/cdn/temp/"
    },
    authHeader: {
        type: OptionType.STRING,
        description: "The raw value for the Authorization header",
        default: "Basic dXNlcjpwYXNzd29yZA=="
    },
    fallbackNoPerms: {
        type: OptionType.BOOLEAN,
        description: "Fallback to CDN if you lack permission to attach files in the channel.",
        default: true,
    },
    fallbackLargeFile: {
        type: OptionType.BOOLEAN,
        description: "Fallback to CDN if a file exceeds the channel's dynamic size limit.",
        default: true,
    }
});

// Calculator thing to figure out upload limit
function getChannelUploadLimit(): number {
    try {
        const channelId = SelectedChannelStore.getChannelId();
        const channel = channelId ? ChannelStore.getChannel(channelId) : null;
        if (!channel) return 10 * 1024 * 1024;

        const user = UserStore.getCurrentUser();
        if (user?.premiumType === 2) return 500 * 1024 * 1024;
        if (user?.premiumType === 1) return 50 * 1024 * 1024;

        if (channel.guild_id) {
            const guild = GuildStore.getGuild(channel.guild_id);
            if (guild) {
                if (typeof guild.maxFileSize === "number") return guild.maxFileSize;
                switch (guild.premiumTier) {
                    case 3: return 100 * 1024 * 1024;
                    case 2: return 50 * 1024 * 1024;
                    case 1: return 50 * 1024 * 1024;
                    default: return 10 * 1024 * 1024;
                }
            }
        }
    } catch (e) {
        console.error("[CustomCdnUploads] Error calculating upload limit:", e);
    }
    return 10 * 1024 * 1024;
}

// Batching states
let currentBatchId: string | null = null;
let totalFilesInBatch = 0;
let completedFilesInBatch = 0;
let batchUploadResults: { id: string; url: string; success: boolean; usedPlaceholder: boolean }[] = [];

// Editing states
let lastGlobalEditTime = 0;
let dirtyUploadIds = new Set<string>();
let uploadProgressMap = new Map<string, number>();
let finalizedUploadIds = new Set<string>();

// Completion tracking
// todo: FIX THE TRACKING AND FALLBACKS
const completedUploads = new Map<string, { url: string; success: boolean }>();
let originalSendMessageDescriptor: PropertyDescriptor | undefined;

// Exactly what the function is called
function findAndEditMessage(channelId: string, uploadIdsToReplace: Map<string, string>) {
    const messages = MessageStore.getMessages(channelId);
    if (!messages) return;

    const msgArray = Array.isArray(messages) 
        ? messages 
        : (messages.toArray ? messages.toArray() : Object.values(messages));
    
    if (!msgArray || msgArray.length === 0) return;

    const currentUser = UserStore.getCurrentUser();
    
    for (let i = msgArray.length - 1; i >= 0; i--) {
        const m = msgArray[i];
        if (m.author?.id === currentUser?.id) {
            const hasTarget = Array.from(uploadIdsToReplace.keys()).some(id => m.content?.includes(id));
            
            if (hasTarget) {
                let newContent = m.content;
                for (const [id, replacement] of uploadIdsToReplace.entries()) {
                    const regex = new RegExp(`\\[media uploading\\.\\.\\.\\s*[^\\]]*${id}\\]`, 'g');
                    newContent = newContent.replace(regex, replacement);
                }
                
                if (newContent.trim().length > 0 && newContent !== m.content) {
                    MessageActions.editMessage(channelId, m.id, { content: newContent.trim() });
                }
                return;
            }
        }
    }
}

// Uploading handling (again, like it says on the can)
const handleUpload = async (e: Event) => {
    let files: File[] = [];
    if (e instanceof ClipboardEvent && e.clipboardData) {
        files = Array.from(e.clipboardData.files);
    } else if (e instanceof DragEvent && e.dataTransfer) {
        files = Array.from(e.dataTransfer.files);
    }

    if (files.length === 0) return;

    let shouldIntercept = settings.store.alwaysUseCdn;

    if (!shouldIntercept) {
        const { fallbackNoPerms, fallbackLargeFile } = settings.store;

        if (fallbackNoPerms) {
            try {
                const channelId = SelectedChannelStore.getChannelId();
                const channel = channelId ? ChannelStore.getChannel(channelId) : null;
                if (channel) {
                    // So apparently this needs overrides? discord is weird
                    const isDM = channel.type === 1 || channel.type === 3 || !channel.guild_id;
                    if (!isDM) {
                        const canAttach = PermissionStore.can(PermissionsBits.ATTACH_FILES, channel);
                        if (!canAttach) shouldIntercept = true;
                    }
                }
            } catch (err) {
                console.error("[CustomCdnUploads] Error checking permissions:", err);
            }
        }

        if (!shouldIntercept && fallbackLargeFile) {
            const limitBytes = getChannelUploadLimit();
            const hasLargeFile = files.some(f => f.size > limitBytes);
            if (hasLargeFile) shouldIntercept = true;
        }
    }

    if (!shouldIntercept) return;

    e.preventDefault();
    e.stopPropagation();

    if (!currentBatchId) {
        currentBatchId = Math.random().toString(36).substring(2, 9);
        updateState({ status: "uploading", progress: 0 });
        totalFilesInBatch = 0;
        completedFilesInBatch = 0;
        batchUploadResults = [];
        lastGlobalEditTime = 0;
        dirtyUploadIds.clear();
        uploadProgressMap.clear();
        finalizedUploadIds.clear();
        completedUploads.clear();
        console.log(`[CustomCdnUploads] Starting new batch ${currentBatchId}`);
    } else {
        console.log(`[CustomCdnUploads] Adding ${files.length} files to existing batch ${currentBatchId}`);
    }

    totalFilesInBatch += files.length;
    const batchIdForThisCall = currentBatchId;

    for (const file of files) {
        const timestamp = Date.now();
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
        const filename = `${timestamp}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        const targetUrl = `${settings.store.cdnUrl}${filename}`;
        
        const uploadId = Math.random().toString(36).substring(2, 9);
        const isLargeFile = file.size > (settings.store.editModeMinSizeMB * 1024 * 1024);
        const usePlaceholder = settings.store.uploadMode === "edit" && isLargeFile;

        if (usePlaceholder) {
            insertTextIntoChatInputBox(`[media uploading... ${uploadId}] `);
        } else {
            insertTextIntoChatInputBox(`[attachment](${targetUrl}) `);
        }

        const xhr = new XMLHttpRequest();
        xhr.open("PUT", targetUrl, true);
        xhr.setRequestHeader("Authorization", settings.store.authHeader);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

        xhr.upload.onprogress = (event) => {
            if (currentBatchId !== batchIdForThisCall) return;
            if (finalizedUploadIds.has(uploadId)) return;

            if (event.lengthComputable) {
                const fileProgress = (event.loaded / event.total) * 100;
                const overallProgress = ((completedFilesInBatch / totalFilesInBatch) * 100) + (fileProgress / totalFilesInBatch);
                updateState({ progress: overallProgress });

                if (usePlaceholder && settings.store.editModeShowProgress) {
                    uploadProgressMap.set(uploadId, fileProgress);
                    dirtyUploadIds.add(uploadId);

                    const now = Date.now();
                    const delay = settings.store.editModeProgressDelay ?? 1500;
                    
                    if (now - lastGlobalEditTime > delay) {
                        lastGlobalEditTime = now;
                        
                        const replacements = new Map<string, string>();
                        for (const id of dirtyUploadIds) {
                            const progress = Math.round(uploadProgressMap.get(id) || 0);
                            replacements.set(id, `[media uploading... ${progress}% | ${id}]`);
                        }
                        
                        findAndEditMessage(SelectedChannelStore.getChannelId(), replacements);
                        dirtyUploadIds.clear();
                    }
                }
            }
        };

        xhr.onload = () => {
            if (currentBatchId !== batchIdForThisCall) return;

            completedFilesInBatch++;
            const success = xhr.status >= 200 && xhr.status < 300;
            const resultUrl = success ? `[attachment](${targetUrl})` : "[upload failed]";
            
            completedUploads.set(uploadId, { url: resultUrl, success });

            batchUploadResults.push({ 
                id: uploadId, 
                url: resultUrl, 
                success, 
                usedPlaceholder: usePlaceholder 
            });

            if (usePlaceholder) {
                finalizedUploadIds.add(uploadId);
                const replacements = new Map<string, string>();
                replacements.set(uploadId, resultUrl);
                findAndEditMessage(SelectedChannelStore.getChannelId(), replacements);
            }

            if (completedFilesInBatch === totalFilesInBatch) {
                finalizeUploads(batchIdForThisCall);
            }
        };

        xhr.onerror = () => {
            if (currentBatchId !== batchIdForThisCall) return;

            completedFilesInBatch++;
            const resultUrl = "[upload failed]";
            
            completedUploads.set(uploadId, { url: resultUrl, success: false });

            batchUploadResults.push({ 
                id: uploadId, 
                url: "", 
                success: false, 
                usedPlaceholder: usePlaceholder 
            });
            
            if (usePlaceholder) {
                finalizedUploadIds.add(uploadId);
                const replacements = new Map<string, string>();
                replacements.set(uploadId, resultUrl);
                findAndEditMessage(SelectedChannelStore.getChannelId(), replacements);
            }

            if (completedFilesInBatch === totalFilesInBatch) {
                finalizeUploads(batchIdForThisCall);
            }
        };

        xhr.send(file);
    }
};

function finalizeUploads(batchId: string) {
    if (currentBatchId !== batchId) return;

    let hasError = false;
    batchUploadResults.forEach(result => {
        if (!result.success) hasError = true;
    });
    
    currentBatchId = null;
    totalFilesInBatch = 0;
    completedFilesInBatch = 0;
    batchUploadResults = [];
    dirtyUploadIds.clear();
    uploadProgressMap.clear();
    finalizedUploadIds.clear();
    // Note: We intentionally leave completedUploads intact until the next batch starts
    // so that pre-send replacement can still work if the user types slowly.
    // ^ Mostly fixed, there is still an edge-case to do with sending on completion, cache state maybe?
    
    if (!hasError) {
        updateState({ status: "success", progress: 100 });
        setTimeout(() => updateState({ status: "idle", progress: 0 }), 2000);
    } else {
        updateState({ status: "error", progress: 100 });
        setTimeout(() => updateState({ status: "idle", progress: 0 }), 3000);
    }
}

// DOM Interception for mode 2
const handleSendIntercept = (e: Event) => {
    if (settings.store.uploadMode === "block" && currentState.status === "uploading") {
        let shouldBlock = false;

        if (e instanceof KeyboardEvent && e.key === "Enter" && !e.shiftKey) {
            const target = e.target as HTMLElement;
            if (target.closest('form[role="form"]') || target.closest('[contenteditable="true"]') || target.closest('textarea')) {
                shouldBlock = true;
            }
        }

        if (e instanceof MouseEvent) {
            const target = e.target as HTMLElement;
            if (target.closest('button[type="submit"]') || target.closest('[aria-label*="Send"]')) {
                shouldBlock = true;
            }
        }

        if (shouldBlock) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            Vencord.showToast("Please wait for the upload to complete", { type: "error" });
        }
    }
};

// Chat button
const ToggleButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { enabled, status, progress } = useUploadState();
    
    const toggle = () => {
        settings.store.alwaysUseCdn = !settings.store.alwaysUseCdn;
        updateState({ enabled: settings.store.alwaysUseCdn });
    };

    if (!isMainChat) return null;

    let barColor = "#5865F2";
    if (status === "error") barColor = "#ED4245";
    else if (status === "success") barColor = "#3BA55C";

    const fillHeight = status === "uploading" ? `${progress}%` : (status === "idle" ? "0%" : "100%");

    return (
        <ChatBarButton
            tooltip={enabled ? "Custom CDN Enabled (Click to disable)" : "Custom CDN Disabled (Click to enable)"}
            onClick={toggle}
        >
            <div style={{ position: "relative", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    width: "100%",
                    height: fillHeight,
                    backgroundColor: barColor,
                    opacity: 0.4,
                    transition: "height 0.2s linear, background-color 0.3s ease",
                    borderRadius: 4,
                    zIndex: 0
                }} />
                <div style={{ position: "relative", zIndex: 1, color: "var(--interactive-normal)" }}>
                    {enabled ? <CdnEnabledIcon /> : <CdnDisabledIcon />}
                </div>
            </div>
        </ChatBarButton>
    );
};

// Definition
export default definePlugin({
    name: "CustomCdnUploads",
    description: "Intercepts file uploads and PUTs them to a custom CDN. Includes fallbacks, coalesced progress editing, and DOM-level send blocking.",
    authors: [{ name: "Hermivore", id: 559811983512305693n }], 
    website: "https://hermivore.cat/", // why cant we do this?
    source: "https://hermivore.cat/cdn/discord/plugins/CDNUpload/index.tsx", // and this?
    settings,

    chatBarButton: {
        render: ToggleButton 
    },

    start() {
        currentState.enabled = settings.store.alwaysUseCdn;
        
        document.addEventListener("paste", handleUpload, true);
        document.addEventListener("drop", handleUpload, true);
        
        document.addEventListener("keydown", handleSendIntercept, true);
        document.addEventListener("click", handleSendIntercept, true);

        // Monkey-patch MessageActions.sendMessage to replace placeholders with actual URLs at the exact moment the message is sent.
        originalSendMessageDescriptor = Object.getOwnPropertyDescriptor(MessageActions, "sendMessage");
        if (originalSendMessageDescriptor && originalSendMessageDescriptor.writable) {
            const original = originalSendMessageDescriptor.value;
            MessageActions.sendMessage = function (this: any, ...args: any[]) {
                const message = args[1];
                if (message && typeof message.content === "string") {
                    let newContent = message.content;
                    let changed = false;
                    
                    for (const [uploadId, result] of completedUploads.entries()) {
                        if (result.success && newContent.includes(uploadId)) {
                            const regex = new RegExp(`\\[media uploading\\.\\.\\.\\s*[^\\]]*${uploadId}\\]`, 'g');
                            newContent = newContent.replace(regex, result.url);
                            changed = true;
                        }
                    }
                    
                    if (changed) {
                        message.content = newContent;
                    }
                }
                return original.apply(this, args);
            };
        }
    },

    stop() {
        document.removeEventListener("paste", handleUpload, true);
        document.removeEventListener("drop", handleUpload, true);
        document.removeEventListener("keydown", handleSendIntercept, true);
        document.removeEventListener("click", handleSendIntercept, true);
        
        // Clean up monkey-patch (learnt this one the hard way)
        if (originalSendMessageDescriptor) {
            Object.defineProperty(MessageActions, "sendMessage", originalSendMessageDescriptor);
            originalSendMessageDescriptor = undefined;
        }
    }
});
