import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { addMessageAccessory } from "@api/MessageAccessories";
import { React } from "@webpack/common";

declare const VencordNative: any;

interface NativeModule {
    startProxy: () => Promise<number>;
    stopProxy: () => void;
}

const Native = VencordNative.pluginHelpers.VoiceNoteTranscriptions as NativeModule;
let proxyPort = 0;

const settings = definePluginSettings({
    apiUrl: {
        type: OptionType.STRING,
        description: "Your STT API Endpoint",
        default: "https://hermivore.cat/api/ai/stt"
    },
    authHeader: {
        type: OptionType.STRING,
        description: "Authorization Header",
        default: "Basic dXNlcjpwYXNzd29yZA=="
    }
});

function TranscriptionAccessory({ message }) {
    const [text, setText] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(false);

    React.useEffect(() => {
        const audioAtt = message.attachments?.find(a => a.waveform || a.content_type?.startsWith("audio/"));
        if (!audioAtt) { 
            setLoading(false); 
            return; 
        }

        const transcribe = () => {
            // Fallback to proxy_url just in case direct CDN fetches are blocked in edge cases
            const audioUrl = audioAtt.proxy_url || audioAtt.url;

            fetch(audioUrl)
                .then(r => r.blob())
                .then(blob => {
                    const form = new FormData();
                    form.append("audio", blob, "voice_note.ogg");
                    
                    // Route through the local Node proxy to bypass Discord's CSP
                    const targetUrl = settings.store.apiUrl;
                    const proxyUrl = proxyPort 
                        ? `http://127.0.0.1:${proxyPort}/stt/${encodeURIComponent(targetUrl)}`
                        : targetUrl;

                    return fetch(proxyUrl, {
                        method: "POST",
                        headers: { "Authorization": settings.store.authHeader },
                        body: form
                    });
                })
                .then(r => r.json())
                .then(data => {
                    if (data?.text) {
                        setText(data.text);
                    } else {
                        setError(true);
                        if (data?.error) console.error("[VoiceNoteTranscriber] API Error:", data.error);
                    }
                })
                .catch(err => {
                    console.error("[VoiceNoteTranscriber] Fetch Error:", err);
                    setError(true);
                })
                .finally(() => setLoading(false));
        };

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => transcribe(), { timeout: 2000 });
        } else {
            setTimeout(() => transcribe(), 100);
        }
    }, [message.id]);

    if (loading) {
        return <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 13 }}>Transcribing voice note...</div>;
    }
    
    if (error || !text) return null;

    return (
        <div style={{
            marginTop: 4, 
            padding: "8px 12px", 
            backgroundColor: "var(--background-secondary)",
            borderRadius: 4, 
            color: "var(--text-muted)",
            fontSize: 14, 
            borderLeft: "3px solid var(--brand-500)",
            maxWidth: "600px",
            lineHeight: 1.4
        }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", fontWeight: "bold", letterSpacing: "0.5px" }}>
                Transcription
            </div>
            {text}
        </div>
    );
}

export default definePlugin({
    name: "VoiceNoteTranscriptions",
    description: "Automatically transcribes voice notes using an STT API. \nAPI must return a {'text': 'transcription'} payload somewhere..",
    authors: [{ name: "Hermivore", id: 559811983512305693n }],
    website: "https://hermivore.cat/",
    source: "https://hermivore.cat/cdn/discord/plugins/VoiceNoteTranscriptions/index.tsx",
    settings,

    async start() {
        // Initialize the local proxy
        try {
            proxyPort = await Native.startProxy();
        } catch (e) {
            console.error("[VoiceNoteTranscriptions] Failed to start proxy:", e);
        }

        addMessageAccessory("VoiceNoteTranscriptions", props => {
            const isVoiceNote = props.message.attachments?.some(a => a.waveform || a.content_type?.startsWith("audio/"));
            if (!isVoiceNote) return null;
            
            return <TranscriptionAccessory message={props.message} />;
        });
    },

    stop() {
        // Clean up the proxy server when the plugin stops
        if (Native && typeof Native.stopProxy === "function") {
            Native.stopProxy();
        }
    }
});