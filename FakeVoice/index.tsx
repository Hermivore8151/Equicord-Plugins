import definePlugin from "@utils/types";
import { findByProps } from "@webpack";

let isFakeMuted = false;
let isFakeDeafened = false;
let originalSend: any;

// CSS
const STYLE_ID = "hermivore-fake-voice-css";
const cssContent = `
    body.hermivore-fake-mute [aria-label="Mute"],
    body.hermivore-fake-mute [aria-label="Unmute"] {
        background-color: var(--brand-500) !important;
    }
    body.hermivore-fake-mute [aria-label="Mute"] svg,
    body.hermivore-fake-mute [aria-label="Unmute"] svg {
        color: white !important;
    }
    
    body.hermivore-fake-deafen [aria-label="Deafen"],
    body.hermivore-fake-deafen [aria-label="Undeafen"] {
        background-color: var(--brand-500) !important;
    }
    body.hermivore-fake-deafen [aria-label="Deafen"] svg,
    body.hermivore-fake-deafen [aria-label="Undeafen"] svg {
        color: white !important;
    }
`;

function injectCSS() {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement;
    if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        document.head.appendChild(style);
    }
    style.innerHTML = cssContent;
}

function removeCSS() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
}

// WS Patch
function patchSocket() {
    const wsModule = findByProps("getSocket");
    if (!wsModule) return;
    
    const socket = wsModule.getSocket();
    if (!socket) return;

    if ((socket.send as any).__fakeVoicePatched) return;

    originalSend = socket.send;
    
    const patchedSend = function (op: number, data: any, ...args: any[]) {
        // Opcode 4 is VOICE_STATE_UPDATE
        if (op === 4 && data) {
            if (isFakeMuted) data.self_mute = true;
            if (isFakeDeafened) data.self_deaf = true;
        }
        return originalSend.apply(this, [op, data, ...args]);
    };
    
    (patchedSend as any).__fakeVoicePatched = true;
    socket.send = patchedSend;
}

function unpatchSocket() {
    if (!originalSend) return;
    const wsModule = findByProps("getSocket");
    if (wsModule) {
        const socket = wsModule.getSocket();
        if (socket) {
            socket.send = originalSend;
        }
    }
    originalSend = null;
}

// Server State Syncing
// Manually forces the server to see the correct state
function refreshServerState() {
    const wsModule = findByProps("getSocket");
    const SelectedChannelStore = findByProps("getVoiceChannelId");
    const ChannelStore = findByProps("getChannel", "getDMFromUserId");
    const MediaEngineStore = findByProps("isDeaf", "isMute");
    
    if (!wsModule || !SelectedChannelStore || !ChannelStore) return;
    
    const socket = wsModule.getSocket();
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    
    if (socket && channelId) {
        // Read the actual local state (which hasn't changed because we blocked the click)
        const actualMute = MediaEngineStore?.isMute() ?? false;
        const actualDeaf = MediaEngineStore?.isDeaf() ?? false;

        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: isFakeMuted || actualMute,
            self_deaf: isFakeDeafened || actualDeaf,
            self_video: false,
            flags: 0
        });
    }
}

// UI Logic
function handleShiftClick(e: MouseEvent) {
    if (!e.shiftKey) return;

    const target = e.target as HTMLElement;
    const muteBtn = target.closest('[aria-label="Mute"], [aria-label="Unmute"]');
    const deafenBtn = target.closest('[aria-label="Deafen"], [aria-label="Undeafen"]');

    if (muteBtn) {
        // Block the event completely so Discord's native onClick never fires
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        isFakeMuted = !isFakeMuted;
        
        if (isFakeMuted) {
            document.body.classList.add("hermivore-fake-mute");
        } else {
            document.body.classList.remove("hermivore-fake-mute");
        }
        refreshServerState();
    }

    if (deafenBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        isFakeDeafened = !isFakeDeafened;
        
        if (isFakeDeafened) {
            document.body.classList.add("hermivore-fake-deafen");
        } else {
            document.body.classList.remove("hermivore-fake-deafen");
        }
        refreshServerState();
    }
}

// Plugin definition
export default definePlugin({
    name: "FakeVoice",
    description: "Shift+Click the Mute/Deafen buttons to fake it. The server thinks you're muted/deafened, but you can still speak/hear. Buttons turn Blurple.",
    authors: [{ name: "Hermivore", id: 559811983512305693n }],
    website: "https://hermivore.cat/",
    source: "https://hermivore.cat/cdn/discord/plugins/FakeVoice/index.tsx",

    start() {
        injectCSS();
        patchSocket();
        document.addEventListener("click", handleShiftClick, true);
    },

    stop() {
        removeCSS();
        unpatchSocket();
        document.removeEventListener("click", handleShiftClick, true);
        document.body.classList.remove("hermivore-fake-mute");
        document.body.classList.remove("hermivore-fake-deafen");
        
        isFakeMuted = false;
        isFakeDeafened = false;
    }
});
