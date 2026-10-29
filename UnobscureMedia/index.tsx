import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { addMessageAccessory } from "@api/MessageAccessories";
import { findByPropsLazy } from "@webpack";
import { React } from "@webpack/common";

const settings = definePluginSettings({
    hidePlaceholder: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord's placeholder (cube + eye button) once the bypass renders.",
        default: true,
    },
    debug: {
        type: OptionType.BOOLEAN,
        description: "Log detection events.",
        default: false,
    },
});

const RestAPI = findByPropsLazy("getAPIBaseURL");
const restCache = new Map<string, any[] | null>();

function UnobscuredMedia({ message }: { message: any }) {
    const [obscured, setObscured] = React.useState(false);
    const [restAtts, setRestAtts] = React.useState<any[] | null>(null);

    // The ONLY signal we trust: Discord rendered its hidden-media placeholder
    // for this message. Clean messages never contain that node.
    React.useEffect(() => {
        let cancelled = false;

        const detect = () => {
            if (cancelled) return;
            const box = document.getElementById(`message-accessories-${message.id}`);
            const node = box?.querySelector('[class*="hiddenExplicit"]');
            if (!node) return;

            setObscured(true);
            if (settings.store.debug) console.info("[UnobscureMedia] detected", message.id);

            if (settings.store.hidePlaceholder) {
                const item = (node as HTMLElement).closest('[class*="nonVisualMediaItemContainer"]') as HTMLElement | null;
                if (item) item.style.display = "none";
            }
        };

        detect();
        requestAnimationFrame(detect); // placeholder can commit a frame late

        return () => { cancelled = true; };
    }, [message.id]);

    // REST fallback only if the store ever lacks urls
    React.useEffect(() => {
        if (!obscured) return;
        if (!message.attachments.some((a: any) => !a.url)) return;
        const cached = restCache.get(message.id);
        if (cached !== undefined) { setRestAtts(cached); return; }
        RestAPI.get({ url: `/channels/${message.channel_id}/messages/${message.id}` })
            .then((res: any) => {
                const atts = res.body?.attachments ?? null;
                restCache.set(message.id, atts);
                setRestAtts(atts);
            })
            .catch(e => console.warn("[UnobscureMedia] REST failed", e));
    }, [obscured, message.id]);

    if (!obscured) return null;

    const attachments = message.attachments.map((a: any) =>
        a.url ? a : restAtts?.find((r: any) => r.id === a.id) ?? a
    );
    const media = attachments.filter((a: any) => a.url && /^(image|video)\//.test(a.content_type ?? ""));
    if (!media.length) return null;

    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, padding: 8, background: "var(--background-tertiary)", borderRadius: 8 }}>
            {media.map((a: any) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                    {/^video\//.test(a.content_type ?? "")
                        ? <video src={a.url} controls style={{ maxWidth: 300, maxHeight: 300, borderRadius: 8 }} />
                        : <img src={a.url} alt={a.filename} style={{ maxWidth: 300, maxHeight: 300, borderRadius: 8 }} />}
                </a>
            ))}
        </div>
    );
}

export default definePlugin({
    name: "UnobscureMedia",
    description: "Renders media Discord hides behind the sensitive-content placeholder.",
    authors: [{ name: "Hermivore", id: 559811983512305693n }],
    settings,

    start() {
        addMessageAccessory("UnobscureMedia", props => {
            try {
                if (!props.message?.attachments?.length) return null;
                return <UnobscuredMedia message={props.message} />;
            } catch (e) {
                console.error("[UnobscureMedia] accessory error", e);
                return null;
            }
        });
    },

    stop() {
        restCache.clear();
    },
});