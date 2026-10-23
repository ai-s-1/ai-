// ERFAN MD - YouTube downloader commands (Nexray API)
import { fileURLToPath } from 'url';
import { cmd } from '../command.js';
import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);

// ============================================
// NEXRAY API
// ============================================
const NEXRAY = "https://api.nexray.eu.cc/downloader";
const API_TIMEOUT = 60000;
const VIDEO_QUALITIES = ["360", "480", "720"]; // tried in this order

const toSmallCaps = (text) => {
    const map = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ғ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ',
        'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ', 's': 's', 't': 'ᴛ',
        'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ'
    };
    return text.split('').map(c => map[c.toLowerCase()] || c).join('');
};

function getVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
        /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
        /(?:m\.youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/watch\/)([a-zA-Z0-9_-]{11})/,
        /(?:music\.youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

// ---- Audio link: ytmp3 first, then ytplay (search by title) as fallback ----
async function getAudioLink(url, title) {
    try {
        const res = await axios.get(`${NEXRAY}/ytmp3`, { params: { url }, timeout: API_TIMEOUT });
        const link = res.data?.status ? res.data?.result?.url : null;
        if (link) return link;
    } catch (e) {
        console.error("⚠️ ytmp3 failed:", e.message);
    }
    if (title) {
        try {
            const res = await axios.get(`${NEXRAY}/ytplay`, { params: { q: title }, timeout: API_TIMEOUT });
            const link = res.data?.status ? res.data?.result?.download_url : null;
            if (link) return link;
        } catch (e) {
            console.error("⚠️ ytplay fallback failed:", e.message);
        }
    }
    return null;
}

// ---- Video link: ytmp4 (tries several qualities) ----
async function getVideoLink(url, qualities = VIDEO_QUALITIES) {
    for (const q of qualities) {
        try {
            const res = await axios.get(`${NEXRAY}/v1/ytmp4`, {
                params: { url, resolusi: q },
                timeout: API_TIMEOUT
            });
            const link = res.data?.status ? res.data?.result?.url : null;
            if (link) return link;
        } catch (e) {
            console.error(`⚠️ ytmp4 (${q}p) failed:`, e.message);
        }
    }
    return null;
}

// ---- Download a remote file to a temp file (stream, low RAM) ----
async function downloadToTemp(link, ext) {
    const tempFile = path.join(os.tmpdir(), `erfan_${Date.now()}_${Math.floor(Math.random() * 1e5)}.${ext}`);
    try {
        const res = await axios({
            method: 'GET',
            url: link,
            responseType: 'stream',
            timeout: 0,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
        });
        const writer = fs.createWriteStream(tempFile);
        res.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
            res.data.on('error', reject);
        });
        return tempFile;
    } catch (e) {
        cleanup(tempFile);
        throw e;
    }
}

function cleanup(file) {
    try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    if (global.gc) global.gc();
}

// ---- Resolve text/URL to a yt-search video object ----
async function resolveVideo(text, suffix = '') {
    const { default: yts } = await import('yt-search');
    if (text.startsWith('http://') || text.startsWith('https://')) {
        if (!text.includes("youtube.com") && !text.includes("youtu.be")) return { error: "❌ Please provide a valid YouTube URL!" };
        const videoId = getVideoId(text);
        if (!videoId) return { error: "❌ Invalid YouTube URL!" };
        const vid = await yts({ videoId });
        return vid ? { vid } : { error: "❌ No results found!" };
    }
    const search = await yts(suffix ? `${text} ${suffix}` : text);
    if (!search?.videos?.length) return { error: "❌ No results found!" };
    return { vid: search.videos[0] };
}

// ---- Download + send audio (as audio or document) ----
async function deliverAudio(conn, from, quoted, vid, asDocument = false) {
    const link = await getAudioLink(vid.url, vid.title);
    if (!link) return false;
    let tempFile = null;
    try {
        tempFile = await downloadToTemp(link, 'mp3');
        if (asDocument) {
            await conn.sendMessage(from, {
                document: { url: tempFile },
                mimetype: "audio/mpeg",
                fileName: `${vid.title}.mp3`,
                caption: `📄 *${vid.title}*\n🎧 Audio Document\n\n> Powered by ERFAN-MD`
            }, { quoted });
        } else {
            await conn.sendMessage(from, {
                audio: { url: tempFile },
                mimetype: "audio/mpeg",
                fileName: `${vid.title}.mp3`,
                ptt: false
            }, { quoted });
        }
        return true;
    } catch (e) {
        console.error("⚠️ Audio deliver failed:", e.message);
        return false;
    } finally {
        cleanup(tempFile);
    }
}

// ---- Download + send video (as video or document) ----
async function deliverVideo(conn, from, quoted, vid, { asDocument = false, emoji = '🎬', qualities } = {}) {
    const link = await getVideoLink(vid.url, qualities);
    if (!link) return false;
    let tempFile = null;
    try {
        tempFile = await downloadToTemp(link, 'mp4');
        if (asDocument) {
            await conn.sendMessage(from, {
                document: { url: tempFile },
                mimetype: "video/mp4",
                fileName: `${vid.title}.mp4`,
                caption: `📄 *${vid.title}*\n📹 Video Document\n\n> Powered by ERFAN-MD`
            }, { quoted });
        } else {
            await conn.sendMessage(from, {
                video: { url: tempFile },
                caption: `${emoji} *${vid.title}*\n\n> Powered by ERFAN-MD`
            }, { quoted });
        }
        return true;
    } catch (e) {
        console.error("⚠️ Video deliver failed:", e.message);
        return false;
    } finally {
        cleanup(tempFile);
    }
}

// ============================================
// COMMAND: play (Auto Audio)
// ============================================
cmd({
    pattern: "play",
    alias: ["audio", "mp3"],
    desc: "Download YouTube audio",
    category: "download",
    react: "🎧",
    filename: __filename
}, async (conn, mek, m, { from, text, reply }) => {
    try {
        if (!text) return reply("❌ Please provide a song name\nExample: .play Shape of You");

        const { vid, error } = await resolveVideo(text);
        if (error) return reply(error);

        await conn.sendMessage(from, {
            image: { url: vid.thumbnail },
            caption: `- *AUDIO DOWNLOADER 🎧*\n╭━━❐━⪼\n┇๏ *Title* - ${vid.title}\n┇๏ *Duration* - ${vid.timestamp}\n┇๏ *Views* - ${vid.views?.toLocaleString() || 'N/A'}\n┇๏ *Author* - ${vid.author?.name || 'Unknown'}\n┇๏ *Status* - Downloading...\n╰━━❑━⪼\n> Powered by ERFAN-MD`
        }, { quoted: mek });

        const ok = await deliverAudio(conn, from, mek, vid);
        if (!ok) return reply("❌ Download failed! Try again later.");
        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });

    } catch (err) {
        console.error("❌ PLAY ERROR:", err);
        reply("❌ An error occurred! Please try again later.");
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
    }
});

// ============================================
// COMMAND: video
// ============================================
cmd({
    pattern: "video",
    alias: ["ytv", "ytmp4", "vd"],
    desc: "Download YouTube video",
    category: "download",
    react: "📹",
    filename: __filename
}, async (conn, mek, m, { from, text, reply }) => {
    try {
        if (!text) return reply("🎥 Please provide a video name or link!\n\nExample: `.video Alone Marshmello`");

        const { vid, error } = await resolveVideo(text);
        if (error) return reply(error);

        await conn.sendMessage(from, {
            image: { url: vid.thumbnail },
            caption: `*🎬 VIDEO DOWNLOADER*\n\n🎞️ *Title:* ${vid.title}\n📺 *Channel:* ${vid.author?.name || 'Unknown'}\n🕒 *Duration:* ${vid.timestamp}\n\n*Status:* Downloading Video...\n\n> Powered by ERFAN-MD`
        }, { quoted: mek });

        const ok = await deliverVideo(conn, from, mek, vid, { emoji: '🎬' });
        if (!ok) return reply("❌ Download failed! Try again later.");
        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });

    } catch (e) {
        console.error("Error in .video command:", e);
        reply("❌ An error occurred, please try again later!");
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
    }
});

// ============================================
// COMMAND: song (Interactive - Audio/Video/AudioDoc/VideoDoc)
// ============================================
cmd({
    pattern: "song",
    alias: ["yt", "music", "ytdl"],
    desc: "Download YouTube song or video (interactive)",
    category: "download",
    react: "🎧",
    filename: __filename
}, async (conn, mek, m, { from, text, reply }) => {
    try {
        if (!text) return reply("🎶 Please provide a YouTube video name or link.\n\nExample: `.song Alone - Alan Walker`");

        const { vid, error } = await resolveVideo(text);
        if (error) return reply(error);

        const caption = `*╭┈───〔 ${toSmallCaps('YT Downloader')} 〕┈───⊷*
*├▢ 🎬 Title:* ${vid.title}
*├▢ 📺 Channel:* ${vid.author?.name || 'Unknown'}
*├▢ ⏰ Duration:* ${vid.timestamp}
*├▢ 👀 Views:* ${vid.views?.toLocaleString() || 'N/A'}
*╰───────────────────⊷*
*╭───⬡ ${toSmallCaps('Select Format')} ⬡───*
*┋ ⬡ 1* 🎧 ${toSmallCaps('Audio (MP3)')}
*┋ ⬡ 2* 📹 ${toSmallCaps('Video (MP4)')}
*┋ ⬡ 3* 📄 ${toSmallCaps('Audio as Document')}
*┋ ⬡ 4* 📄 ${toSmallCaps('Video as Document')}
*╰───────────────────⊷*

> Powered by ERFAN-MD`;

        const sent = await conn.sendMessage(from, {
            image: { url: vid.thumbnail },
            caption
        }, { quoted: mek });

        const msgId = sent.key.id;

        const songListener = async (msgData) => {
            const received = msgData.messages[0];
            if (!received.message) return;

            const selected = received.message.conversation || received.message.extendedTextMessage?.text;
            const replyToBot = received.message.extendedTextMessage?.contextInfo?.stanzaId === msgId;
            if (!replyToBot) return;

            conn.ev.off("messages.upsert", songListener);
            await conn.sendMessage(from, { react: { text: '⬇️', key: received.key } });

            const choice = selected?.trim();
            if (!["1", "2", "3", "4"].includes(choice)) {
                return await conn.sendMessage(from, {
                    text: `❌ *Invalid selection!*\nPlease reply with:\n1️⃣ for Audio (MP3)\n2️⃣ for Video (MP4)\n3️⃣ for Audio as Document\n4️⃣ for Video as Document`
                }, { quoted: received });
            }

            const isAudio = choice === "1" || choice === "3";
            const asDocument = choice === "3" || choice === "4";

            const ok = isAudio
                ? await deliverAudio(conn, from, received, vid, asDocument)
                : await deliverVideo(conn, from, received, vid, { asDocument });

            if (!ok) {
                return await conn.sendMessage(from, {
                    text: `❌ ${isAudio ? 'Audio' : 'Video'} download failed! Try again later.`
                }, { quoted: received });
            }
            await conn.sendMessage(from, { react: { text: '✅', key: received.key } });
        };

        conn.ev.on("messages.upsert", songListener);
        setTimeout(() => { conn.ev.off("messages.upsert", songListener); }, 30000);

    } catch (e) {
        console.error(e);
        reply(`❌ Error: ${e.message}`);
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
    }
});

// ============================================
// COMMAND: drama (Video Only - Interactive)
// ============================================
cmd({
    pattern: "drama",
    alias: ["film", "series"],
    desc: "Download YouTube drama/movie video (interactive)",
    category: "download",
    react: "🎬",
    filename: __filename
}, async (conn, mek, m, { from, text, reply }) => {
    try {
        if (!text) return reply("🎬 Please provide a drama/movie name or link.\n\nExample: `.drama Muskan 5`");

        const { vid, error } = await resolveVideo(text);
        if (error) return reply(error);

        const caption = `*╭┈───〔 ${toSmallCaps('Drama Downloader')} 〕┈───⊷*
*├▢ 🎬 Title:* ${vid.title}
*├▢ 📺 Channel:* ${vid.author?.name || 'Unknown'}
*├▢ ⏰ Duration:* ${vid.timestamp}
*├▢ 👀 Views:* ${vid.views?.toLocaleString() || 'N/A'}
*╰───────────────────⊷*
*╭───⬡ ${toSmallCaps('Select Format')} ⬡───*
*┋ ⬡ 1* 📹 ${toSmallCaps('Video (MP4)')}
*┋ ⬡ 2* 📄 ${toSmallCaps('Video as Document')}
*╰───────────────────⊷*

> Powered by ERFAN-MD`;

        const sent = await conn.sendMessage(from, {
            image: { url: vid.thumbnail },
            caption
        }, { quoted: mek });

        const msgId = sent.key.id;

        const dramaListener = async (msgData) => {
            const received = msgData.messages[0];
            if (!received.message) return;

            const selected = received.message.conversation || received.message.extendedTextMessage?.text;
            const replyToBot = received.message.extendedTextMessage?.contextInfo?.stanzaId === msgId;
            if (!replyToBot) return;

            conn.ev.off("messages.upsert", dramaListener);
            await conn.sendMessage(from, { react: { text: '⬇️', key: received.key } });

            const choice = selected?.trim();
            if (choice !== "1" && choice !== "2") {
                return await conn.sendMessage(from, {
                    text: `❌ *Invalid selection!*\nPlease reply with:\n1️⃣ for Video (MP4)\n2️⃣ for Video as Document`
                }, { quoted: received });
            }

            const ok = await deliverVideo(conn, from, received, vid, { asDocument: choice === "2" });
            if (!ok) {
                return await conn.sendMessage(from, {
                    text: "❌ Video download failed! Try again later."
                }, { quoted: received });
            }
            await conn.sendMessage(from, { react: { text: '✅', key: received.key } });
        };

        conn.ev.on("messages.upsert", dramaListener);
        setTimeout(() => { conn.ev.off("messages.upsert", dramaListener); }, 30000);

    } catch (e) {
        console.error(e);
        reply(`❌ Error: ${e.message}`);
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
    }
});

// ============================================
// COMMAND: cartoon
// ============================================
cmd({
    pattern: "cartoon",
    alias: ["toon", "kids"],
    desc: "Download YouTube cartoon video",
    category: "download",
    react: "🧸",
    filename: __filename
}, async (conn, mek, m, { from, text, reply }) => {
    try {
        if (!text) return reply("🧸 Please provide a cartoon name!\n\nExample: `.cartoon Tom and Jerry`");

        const { vid, error } = await resolveVideo(text, 'cartoon');
        if (error) return reply(error);

        await conn.sendMessage(from, {
            image: { url: vid.thumbnail },
            caption: `*🧸 CARTOON DOWNLOADER*\n\n🎞️ *Title:* ${vid.title}\n📺 *Channel:* ${vid.author?.name || 'Unknown'}\n🕒 *Duration:* ${vid.timestamp}\n\n*Status:* Downloading Cartoon...\n\n> Powered by ERFAN-MD`
        }, { quoted: mek });

        const ok = await deliverVideo(conn, from, mek, vid, { emoji: '🧸' });
        if (!ok) return reply("❌ Download failed! Try again later.");
        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });

    } catch (e) {
        console.error("Error in .cartoon command:", e);
        reply("❌ An error occurred, please try again later!");
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
    }
});

// ============================================
// COMMAND: movie (sent as document, 360p to keep size safe)
// ============================================
cmd({
    pattern: "movie",
    alias: ["playmovie", "dlmovie"],
    desc: "Search a full movie on YouTube and download it as a document",
    category: "download",
    react: "🍿",
    filename: __filename
}, async (conn, mek, m, { from, text, reply }) => {
    try {
        if (!text) {
            return reply("❌ *Please provide a movie name!*\n\nExample: `.movie DJ Ganesh Chaturthi`");
        }
        if (text.startsWith('http://') || text.startsWith('https://')) {
            return reply("❌ URLs are not supported here.\nPlease send a movie *name* only.");
        }

        await conn.sendMessage(from, { react: { text: "⚡", key: mek.key } });

        const { vid, error } = await resolveVideo(text, 'full movie');
        if (error) return reply(error);

        await conn.sendMessage(from, {
            image: { url: vid.thumbnail },
            caption: `*╭┈───〔 ${toSmallCaps('Movie Downloader')} 〕┈───⊷*
*├▢ 🍿 Title:* ${vid.title}
*├▢ 📺 Channel:* ${vid.author?.name || 'Unknown'}
*├▢ ⏰ Duration:* ${vid.timestamp}
*├▢ 👀 Views:* ${vid.views?.toLocaleString() || 'N/A'}
*╰───────────────────⊷*
_⚡ Downloading as document..._

> Powered by ERFAN-MD`
        }, { quoted: mek });

        const ok = await deliverVideo(conn, from, mek, vid, { asDocument: true, qualities: ["360"] });
        if (!ok) return reply("❌ Failed to get the movie! Try again later.");
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

    } catch (e) {
        await reply("❌ Error: " + (e?.message || e));
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
    }
});

// ============================================
// COMMAND: yts (Search)
// ============================================
cmd({
    pattern: "yts",
    alias: ["ytsearch", "searchyt"],
    use: '.yts ERFAN',
    react: "🔎",
    desc: "Search YouTube and get video details",
    category: "search",
    filename: __filename
},
async (conn, mek, m, { from, text, reply }) => {
    try {
        if (!text) return reply('*Please provide search words!*\n\nExample: .yts Alan Walker Faded');

        const { default: yts } = await import('yt-search');
        const search = await yts(text);

        if (!search.videos || !search.videos.length) {
            return reply('*No results found!*');
        }

        const results = search.videos.slice(0, 10);

        let mesaj = `*╭┈───〔 ${toSmallCaps('YouTube Search')} 〕┈───⊷*\n`;
        mesaj += `*├▢ 🔎 Query:* ${text}\n`;
        mesaj += `*├▢ 📊 Results:* ${search.videos.length}\n`;
        mesaj += `*╰───────────────────⊷*\n\n`;

        results.forEach((video, i) => {
            mesaj += `*${i + 1}. ${video.title}*\n`;
            mesaj += `*├▢ 🔗 URL:* ${video.url}\n`;
            mesaj += `*├▢ ⏱️ Duration:* ${video.timestamp}\n`;
            mesaj += `*├▢ 👀 Views:* ${video.views?.toLocaleString() || 'N/A'}\n`;
            mesaj += `*├▢ 👤 Channel:* ${video.author?.name || 'Unknown'}\n`;
            mesaj += `*╰───────────────────⊷*\n\n`;
        });

        mesaj += `*╭───⬡ ${toSmallCaps('Powered By')} ⬡ ───*\n`;
        mesaj += `*┋ ⬡ ${toSmallCaps('ERFAN-MD')}*\n`;
        mesaj += `*╰───────────────────⊷*`;

        await conn.sendMessage(from, { text: mesaj.trim() }, { quoted: mek });

    } catch (e) {
        console.error('Error in yts command:', e);
        reply(`*Error occurred while searching!*\n\`\`\`${e.message}\`\`\``);
    }
});
