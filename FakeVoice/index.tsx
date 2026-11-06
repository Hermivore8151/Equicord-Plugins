import definePlugin from "@utils/types";
import { findByProps } from "@webpack";

// CSS — unchanged, your original selectors work fine
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
    document.getElementById(STYLE_ID)?.remove();
}

// Forces Discord to emit VOICE_STATE_UPDATE payloads (which our webpack patch
// rewrites) while returning the local media engine to its original state.
function syncState() {
    // NOTE: the action is "toggleSelfDeaf", NOT "toggleSelfDeafen"!
    const VoiceActions = findByProps("toggleSelfMute");
    const SelectedChannelStore = findByProps("getVoiceChannelId");

    if (!VoiceActions || !SelectedChannelStore?.getVoiceChannelId()) return;

    VoiceActions.toggleSelfMute();
    VoiceActions.toggleSelfMute();
    VoiceActions.toggleSelfDeaf();
    VoiceActions.toggleSelfDeaf();
}

// UI Logic — unchanged, your original detection works fine
function handleShiftClick(e: MouseEvent) {
    if (!e.shiftKey || !plugin) return;

    const target = e.target as HTMLElement;
    const muteBtn = target.closest('[aria-label="Mute"], [aria-label="Unmute"]');
    const deafenBtn = target.closest('[aria-label="Deafen"], [aria-label="Undeafen"]');

    if (muteBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        plugin.isFakeMuted = !plugin.isFakeMuted;
        document.body.classList.toggle("hermivore-fake-mute", plugin.isFakeMuted);
        syncState();
    }

    if (deafenBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        plugin.isFakeDeafened = !plugin.isFakeDeafened;
        document.body.classList.toggle("hermivore-fake-deafen", plugin.isFakeDeafened);
        syncState();
    }
}

let plugin: any = null;

export default definePlugin({
    name: "FakeVoice",
    description: "Shift+Click the Mute/Deafen buttons to fake it. The server thinks you're muted/deafened, but you can still speak/hear. Buttons turn Blurple.",
    authors: [{ name: "Hermivore", id: 559811983512305693n }],
    website: "https://hermivore.cat/",
    source: "https://hermivore.cat/cdn/discord/plugins/FakeVoice/index.tsx",

    // Live on the plugin instance so $self can read them inside the patch
    isFakeMuted: false,
    isFakeDeafened: false,

    patches: [
        {
            // Intercepts the gateway payload builder, before any socket transport
            find: "}voiceStateUpdate(",
            replacement: {
                match: /self_mute:([^,]+),self_deaf:([^,]+),self_video:([^,]+)/,
                replace: "self_mute:$1||$self.isFakeMuted,self_deaf:$2||$self.isFakeDeafened,self_video:$3"
            }
        }
    ],

    start() {
        plugin = this;
        injectCSS();
        document.addEventListener("click", handleShiftClick, true);
    },

    stop() {
        removeCSS();
        document.removeEventListener("click", handleShiftClick, true);
        document.body.classList.remove("hermivore-fake-mute");
        document.body.classList.remove("hermivore-fake-deafen");

        this.isFakeMuted = false;
        this.isFakeDeafened = false;
        plugin = null;
    }
});
