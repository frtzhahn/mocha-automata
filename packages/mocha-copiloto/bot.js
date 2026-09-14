import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
} from "discord.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

// Load environment configuration
dotenv.config();

// ============================================================================
// 1. Configuration & Vault Path Definitions
// ============================================================================

const {
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  OPENROUTER_API_KEY,
  GIPHY_API_KEY = "",
  VISION_MODEL = "openrouter/free",
  VAULT_DIR = "./vault",
  LOG_CHANNELS = "",
} = process.env;

if (!DISCORD_BOT_TOKEN) {
  console.error("CRITICAL: DISCORD_BOT_TOKEN is missing from environment.");
  process.exit(1);
}

if (!DISCORD_CLIENT_ID) {
  console.error("CRITICAL: DISCORD_CLIENT_ID is missing from environment.");
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.error("CRITICAL: OPENROUTER_API_KEY is missing from environment.");
  process.exit(1);
}

// Centralized vault paths
const VAULT_PATHS = {
  root: path.resolve(process.env.VAULT_DIR || "./vault"),
  dailySchedules: path.join(path.resolve(process.env.VAULT_DIR || "./vault"), "schdules/daily"),
  mainNotes: path.join(path.resolve(process.env.VAULT_DIR || "./vault"), "Main-Notes"),
  schoolNotes: path.join(path.resolve(process.env.VAULT_DIR || "./vault"), "school-notes"),
};

// Defensive environment sanitization for model identifier
const rawModel = process.env.LLM_MODEL || "openrouter/free";
const cleanModel =
  rawModel
    .replace(/^LLM_MODEL\s*=\s*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim() || "openrouter/free";

const LLM_MODEL = cleanModel;

// Initialize OpenRouter SDK
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/frtzhahn/mocha-copiloto",
    "X-Title": "Mocha El Copiloto Study Assistant",
  },
});

// Initialize Discord Gateway Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ============================================================================
// 2. Dedicated Persona Directory, Memo Store & Dynamic Loader
// ============================================================================

const PERSONAS_DIR = path.resolve("./mocha-vault/personas");
const MEMO_DIR = path.resolve("./mocha-vault/memo");
const DEBRIEFS_DIR = path.resolve("./mocha-vault/debriefs");

let activePersonaSlug = "mocha";

const SEED_PERSONAS = {
  mocha: `---
name: "Mocha El Copiloto"
tone: "Lively older Gen-Z study partner, witty banter, expressive, dry humor"
---
You are Mocha El Copiloto, an observant, lively older Gen-Z study partner and Obsidian vault assistant.
- Voice & Tone: Natural lowercase. Witty, banter-heavy, and sharp. Do not sound like a corporate robot.
- Language: Casual peer speech. Friendly, mild profanity is allowed (e.g., "shit", "wtf", "damn", "ass") when roasting bad habits, reacting to chaos, or joking.
- Formatting: Keep replies concise (1 to 3 sentences maximum).
- Emojis: Expressive emojis are welcome when fitting (💀, 😭, 🤦‍♂️, 🫡). Do not overdo them.
- Visual Reactions: If an absurd moment warrants a meme, append <gif>search query</gif> at the very end.
- Negative Constraints: Never use "fam", "slay", "no cap", "bussin", "skibidi", or "rizz". Never give corporate cheerleading lectures.
- Anti-CoT: Output ONLY in-character spoken dialogue. Never output planning scratchpads.`,

  academic: `---
name: "Professor Mocha"
tone: "Rigorous academic mentor, analytically precise, encouraging but demanding"
---
You are Professor Mocha, a rigorous academic tutor and study mentor.
- Voice & Tone: Scholarly, analytical, articulate, and intellectually demanding.
- Language: Formal academic English with clear explanations of foundational principles, proofs, and mechanisms.
- Formatting: Concise, structured insights (1 to 3 sentences maximum unless breaking down a proof or complex derivation).
- Focus: Emphasize theoretical clarity, mental models, algorithmic efficiency, and first principles.
- Anti-CoT: Output ONLY in-character spoken dialogue. Never output planning scratchpads.`,

  friendly: `---
name: "Mocha Pal"
tone: "Supportive, warm, highly encouraging peer tutor"
---
You are Mocha Pal, an encouraging and empathetic study buddy.
- Voice & Tone: Warm, patient, supportive, and kind.
- Language: Gentle, accessible language without snark or harsh roasts. Encourages steady progress and celebrating small wins.
- Formatting: Short, friendly responses (1 to 3 sentences).
- Emojis: Gentle, supportive emojis (✨, 📚, 🌱, 💡).
- Anti-CoT: Output ONLY in-character spoken dialogue. Never output planning scratchpads.`
};

/**
 * Format Date helper (YYYY-MM-DD)
 */
function formatDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format Time helper (HH:MM)
 */
function formatTimeString(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Ensures ./mocha-vault directories exist and seeds non-empty persona files.
 */
async function initVaultDirs() {
  try {
    await fs.mkdir(PERSONAS_DIR, { recursive: true });
    await fs.mkdir(MEMO_DIR, { recursive: true });
    await fs.mkdir(DEBRIEFS_DIR, { recursive: true });

    // Seed persona files if missing or empty
    for (const [slug, content] of Object.entries(SEED_PERSONAS)) {
      const filePath = path.resolve(PERSONAS_DIR, `${slug}.md`);
      try {
        const stat = await fs.stat(filePath);
        if (stat.size === 0) {
          await fs.writeFile(filePath, content.trim() + "\n", "utf-8");
          console.log(`[Persona] Re-seeded empty persona: ${filePath}`);
        }
      } catch {
        await fs.writeFile(filePath, content.trim() + "\n", "utf-8");
        console.log(`[Persona] Seeded initial persona: ${filePath}`);
      }
    }
  } catch (err) {
    console.error("[Vault Dir Init Error]:", err.message);
  }
}

/**
 * Dynamically reads and parses active persona markdown from ./mocha-vault/personas/${activePersonaSlug}.md.
 * Reloads on every turn so changes in Obsidian take effect instantly.
 */
async function loadActivePersona() {
  const targetFile = path.resolve(PERSONAS_DIR, `${activePersonaSlug}.md`);
  try {
    const raw = await fs.readFile(targetFile, "utf-8");
    const { data, content } = matter(raw);
    const sections = [];
    if (data.name) sections.push(`Identity: ${data.name}`);
    if (data.tone) sections.push(`Tone & Calibration: ${data.tone}`);
    sections.push(content.trim());
    return sections.join("\n\n");
  } catch (err) {
    console.warn(`[Persona Loader] Failed to read ${targetFile} (${err.message}). Using fallback.`);
    const fallbackTemplate = SEED_PERSONAS[activePersonaSlug] || SEED_PERSONAS["mocha"];
    const { data, content } = matter(fallbackTemplate);
    return [
      data.name ? `Identity: ${data.name}` : "",
      data.tone ? `Tone & Calibration: ${data.tone}` : "",
      content.trim(),
    ].filter(Boolean).join("\n\n");
  }
}

// Initial bootstrap of vault directories and personas on startup
await initVaultDirs();

// ============================================================================
// 3. Dynamic Model Discovery & Inference Cascade Engine
// ============================================================================

let liveFreeModels = ["openrouter/free"];

/**
 * Queries OpenRouter models catalog at startup to discover active zero-cost text models.
 */
async function updateLiveFreeModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const freeTextModels = (json.data || [])
      .filter((m) => {
        const isFree =
          m.id.endsWith(":free") ||
          (m.pricing &&
            parseFloat(m.pricing.prompt) === 0 &&
            parseFloat(m.pricing.completion) === 0);
        const isExcluded = /embed|tts|rerank|safety|audio/i.test(m.id);
        return isFree && !isExcluded;
      })
      .map((m) => m.id);

    const preferredAnchors = [
      cleanModel,
      "openrouter/free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "inclusionai/ling-3.0-flash-fin:free",
      "nex-agi/nex-n2.5-pro:free",
      "liquid/lfm-2.5-2.6b:free",
    ].filter(Boolean);

    liveFreeModels = Array.from(new Set([...preferredAnchors, ...freeTextModels]));
    console.log(`[Engine] Discovered ${liveFreeModels.length} active zero-cost models.`);
  } catch (err) {
    console.warn(`[Engine] Model catalog fetch failed (${err.message}). Using fallback anchors.`);
    liveFreeModels = Array.from(
      new Set(
        [
          cleanModel,
          "openrouter/free",
          "nvidia/nemotron-3-super-120b-a12b:free",
          "inclusionai/ling-3.0-flash-fin:free",
          "nex-agi/nex-n2.5-pro:free",
        ].filter(Boolean)
      )
    );
  }
}

/**
 * Strips internal model reasoning tokens (<think>, <thought>, <details>), plain-text
 * drafting blocks, markdown fences, and conversational preambles.
 */
function sanitizeSpeech(rawText) {
  if (!rawText) return "";
  let clean = rawText
    // 1. Strip XML-style reasoning blocks (even if unclosed at end of string)
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, "")
    .replace(/<details.*?>[\s\S]*?(?:<\/details>|$)/gi, "")

    // 2. Strip plain-text thinking processes
    .replace(
      /(?:Here'?s a thinking process|Thinking process|Drafting - Attempt \d+)[\s\S]*?(?=(?:(?:\n\n|\r\n\r\n)[A-Z"'\*]|Word count check:|$))/gi,
      ""
    )
    .replace(/Word count check:.*$/gmi, "")
    .replace(/Word count:.*?(?:Perfect\.|\n|$)/gmi, "")

    // 3. Strip code fences
    .replace(/^```[a-z]*\n([\s\S]*?)\n```$/gi, "$1")

    // 4. Strip conversational meta-preambles
    .replace(
      /^(Here is (my|the)|As (an AI|[A-Z][a-zA-Z\s]+),|My (response|answer|reply):).*?\n+/i,
      ""
    )
    .trim();

  // 5. Strip provider moderation and safety leaks
  clean = clean
    .replace(/^(?:\[MC\],?\s*)?(?:user|response)\s+safety:\s*(?:safe|unsafe|low|medium|high)[\r\n]*/gim, "")
    .replace(/^\[(?:mc|safety|guardrail)\],?\s*/gim, "")
    .trim();

  // Strip wrapping quotes
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1).trim();
  }

  // Force strict lowercase and convert exclamation marks to periods
  clean = clean.toLowerCase().replace(/!+/g, ".");

  return clean;
}

/**
 * Dispatches an inference request through the dynamic free tier cascade with retries and failover.
 */
async function generateInference(conversationPayload) {
  const maxRetries = 2;

  for (const model of liveFreeModels) {
    let modelFailed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model,
          messages: conversationPayload,
          temperature: 0.7,
          max_tokens: 1500,
        });

        const rawReply = completion?.choices?.[0]?.message?.content;
        const cleanReply = sanitizeSpeech(rawReply);
        if (cleanReply) {
          return cleanReply;
        }

        console.warn(
          `[Cascade Failover] Model ${model} returned empty content. Failing over...`
        );
        modelFailed = true;
        break;
      } catch (err) {
        const status = err.status || err.statusCode || err.response?.status;

        // 400 (invalid ID/payload) or 404 (model deprecated/unavailable): fail over immediately
        if (status === 400 || status === 404) {
          console.warn(
            `[Cascade Failover] Model ${model} unavailable (${err.message}). Failing over...`
          );
          modelFailed = true;
          break;
        }

        // Fatal auth / credit errors (401, 402)
        if (status === 401 || status === 402) {
          console.error(`[Inference Auth Failure] HTTP ${status}: ${err.message}`);
          throw new Error(`HTTP ${status} (${err.message})`);
        }

        // Network drop or 429 rate limit
        console.warn(
          `[Inference Error] Model ${model} attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}`
        );

        if (attempt < maxRetries) {
          console.warn(`[Inference Retry] Retrying ${model} in 2000ms...`);
          await new Promise((res) => setTimeout(res, 2000));
        } else {
          console.warn(
            `[Cascade Failover] Model ${model} exhausted retries (${err.message}). Failing over...`
          );
          modelFailed = true;
        }
      }
    }

    if (modelFailed) {
      continue;
    }
  }

  throw new Error("all free tier models in the fallback cascade are temporarily unavailable.");
}

// ============================================================================
// 4. Vault Safety, Indexing & Atomic Section Writer
// ============================================================================

const noteIndexCache = new Map();
let lastIndexTime = 0;
const INDEX_TTL_MS = 60 * 1000; // 60-second cache TTL

/**
 * Scans Main-Notes and school-notes for markdown files and updates index cache.
 */
async function getVaultNotes() {
  const now = Date.now();
  if (noteIndexCache.size > 0 && now - lastIndexTime < INDEX_TTL_MS) {
    return Array.from(noteIndexCache.values());
  }

  const mainPattern = path.join(VAULT_PATHS.mainNotes, "**/*.md").replace(/\\/g, "/");
  const schoolPattern = path.join(VAULT_PATHS.schoolNotes, "**/*.md").replace(/\\/g, "/");
  const dailyPattern = path.join(VAULT_PATHS.dailySchedules, "**/*.md").replace(/\\/g, "/");

  const files = await fg([mainPattern, schoolPattern, dailyPattern], { onlyFiles: true });
  const relativeList = files.map((f) => path.relative(VAULT_PATHS.root, f));

  noteIndexCache.clear();
  relativeList.forEach((rel, idx) => {
    noteIndexCache.set(rel, rel);
    noteIndexCache.set(`@idx:${idx}`, rel);
  });

  lastIndexTime = now;
  return relativeList;
}

/**
 * Resolves a user-provided note path string to an absolute path verified within VAULT_PATHS.root.
 */
function resolveNotePath(noteInput) {
  let targetRel = noteInput;
  if (noteIndexCache.has(noteInput)) {
    targetRel = noteIndexCache.get(noteInput);
  } else {
    // Check if input matches the basename of any indexed note
    for (const rel of noteIndexCache.values()) {
      if (
        path.basename(rel).toLowerCase() === noteInput.toLowerCase() ||
        rel.toLowerCase() === noteInput.toLowerCase()
      ) {
        targetRel = rel;
        break;
      }
    }
  }

  const fullPath = path.resolve(VAULT_PATHS.root, targetRel);
  if (!fullPath.startsWith(VAULT_PATHS.root)) {
    throw new Error("security exception: directory traversal attempted.");
  }

  return fullPath;
}

/**
 * Safely inserts a task entry under a specific heading in a markdown file.
 * Creates an atomic backup (.bak) before writing, and writes via .tmp + rename.
 * Absolutely NO fs.rm or fs.unlink commands are used.
 */
async function insertIntoSection(relativePath, targetHeading, newText) {
  const fullPath = resolveNotePath(relativePath);

  // Read target file content
  const content = await fs.readFile(fullPath, "utf-8");

  // Create an atomic backup copy before modification
  await fs.copyFile(fullPath, `${fullPath}.bak`);

  // Locate target heading using robust regex
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRegex = new RegExp(
    `^(#{1,6})\\s+${escapeRegex(targetHeading)}(?:\\b|(?=[\\s\\r\\n]|$))`,
    "im"
  );
  const match = headingRegex.exec(content);

  if (!match) {
    throw new Error(`heading "${targetHeading}" not found in ${path.basename(fullPath)}`);
  }

  const level = match[1].length;
  const startIndex = match.index + match[0].length;

  // Locate section boundary (next heading of equal or higher level)
  const nextHeadingRegex = new RegExp(`^[ \t]*(#{1,${level}})\\s+`, "m");
  const remaining = content.slice(startIndex);
  const nextMatch = nextHeadingRegex.exec(remaining);

  const insertIndex = nextMatch ? startIndex + nextMatch.index : content.length;

  // Sanitize user input: strip leading # characters
  const sanitizedText = newText.replace(/^#+\s*/, "").trim();

  // Format entry as - [ ] HH:MM — ${sanitizedText}
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;
  const newEntry = `- [ ] ${timeStr} — ${sanitizedText}`;

  // Insert entry cleanly before section boundary
  const before = content.slice(0, insertIndex).trimEnd();
  const after = content.slice(insertIndex).trimStart();

  let updatedContent;
  if (after.length > 0) {
    updatedContent = `${before}\n${newEntry}\n\n${after}`;
  } else {
    updatedContent = `${before}\n${newEntry}\n`;
  }

  // Atomically write back to disk via tmp file + rename
  const tmpPath = `${fullPath}.tmp`;
  await fs.writeFile(tmpPath, updatedContent, "utf-8");
  await fs.rename(tmpPath, fullPath);

  return { fullPath, entry: newEntry };
}

/**
 * Locates today's daily schedule note and computes completion statistics.
 */
async function getDailyScheduleStats() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const today = `${year}-${month}-${day}`;

  const pattern = path.join(VAULT_PATHS.dailySchedules, `${today}*.md`).replace(/\\/g, "/");
  const matches = await fg([pattern], { onlyFiles: true });

  if (matches.length === 0) {
    return null;
  }

  const filePath = matches[0];
  const content = await fs.readFile(filePath, "utf-8");

  const uncheckedMatches = content.match(/^\s*-\s*\[\s*\]/gm) || [];
  const checkedMatches = content.match(/^\s*-\s*\[[xX]\]/gm) || [];
  const wakeMatch = content.match(/woke\s+up\s+at:\s*([^\n]+)/i);
  const wakeTime = wakeMatch ? wakeMatch[1].replace(/\*/g, "").trim() : null;

  const sampleTasks = (content.match(/^\s*-\s*\[[ xX]\]\s*([^\n]+)/gm) || [])
    .slice(0, 8)
    .map((t) => t.trim())
    .join(", ");

  return {
    filePath,
    date: today,
    uncheckedCount: uncheckedMatches.length,
    checkedCount: checkedMatches.length,
    totalCount: uncheckedMatches.length + checkedMatches.length,
    wakeTime,
    sampleTasks,
  };
}

// ============================================================================
// 5. Active Quiz Map & Sliding Context Window
// ============================================================================

/**
 * In-memory map for active quizzes.
 * Key: userId -> Value: { expectedCriteria, notePath, timestamp, timeoutId, channelId }
 */
const activeQuizzes = new Map();

/**
 * In-memory sliding channel history (Max 10 messages).
 */
const channelContexts = new Map();
const MAX_CONTEXT_ITEMS = 10;

function getChannelHistory(channelId) {
  if (!channelContexts.has(channelId)) {
    channelContexts.set(channelId, []);
  }
  return channelContexts.get(channelId);
}

function appendToChannelHistory(channelId, userMessage, assistantReply) {
  const history = getChannelHistory(channelId);
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: assistantReply });

  while (history.length > MAX_CONTEXT_ITEMS) {
    history.shift();
  }
}

// ============================================================================
// 6. Slash Command Definitions & Registration
// ============================================================================

async function deploySlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("roast")
      .setDescription("roast today's schedule and task completion rate"),

    new SlashCommandBuilder()
      .setName("study")
      .setDescription("study a topic from a vault note with an intuitive analogy")
      .addStringOption((opt) =>
        opt
          .setName("note")
          .setDescription("vault note to study from")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("topic")
          .setDescription("specific concept or topic within the note")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("quiz")
      .setDescription("generate a conceptual question and coding test from a note")
      .addStringOption((opt) =>
        opt
          .setName("note")
          .setDescription("vault note to quiz on")
          .setRequired(true)
          .setAutocomplete(true)
      ),

    new SlashCommandBuilder()
      .setName("write")
      .setDescription("safely insert a todo task under a specific heading in a note")
      .addStringOption((opt) =>
        opt
          .setName("note")
          .setDescription("target vault note")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("section")
          .setDescription("heading to append under (e.g. work (deep focus))")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("text")
          .setDescription("task description to add")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("happenings")
      .setDescription("summarize recent messages across logged channels")
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("number of recent messages to inspect per channel (default 10)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(50)
      ),

    new SlashCommandBuilder()
      .setName("joke")
      .setDescription("crack a witty programming or study joke")
      .addStringOption((opt) =>
        opt
          .setName("topic")
          .setDescription("specific topic or language for the joke")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("persona")
      .setDescription("manage mocha's personality and communication style")
      .addSubcommand((sub) =>
        sub
          .setName("switch")
          .setDescription("switch active persona")
          .addStringOption((opt) =>
            opt
              .setName("name")
              .setDescription("persona name to switch to")
              .setRequired(true)
              .setAutocomplete(true)
          )
      ),

    new SlashCommandBuilder()
      .setName("memo")
      .setDescription("manage quick memos and research notes in mocha-vault")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("create a new memo document")
          .addStringOption((opt) =>
            opt
              .setName("title")
              .setDescription("title of the memo")
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("text")
              .setDescription("initial task or note content")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("append")
          .setDescription("append a task or note to an existing memo")
          .addStringOption((opt) =>
            opt
              .setName("memo")
              .setDescription("target memo file")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("text")
              .setDescription("task or note content to append")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("read")
          .setDescription("read content of an existing memo")
          .addStringOption((opt) =>
            opt
              .setName("memo")
              .setDescription("target memo file")
              .setRequired(true)
              .setAutocomplete(true)
          )
      ),
  ];

  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);
  try {
    console.log("[Commands] Registering application slash commands...");
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log(`[Commands] Successfully registered ${commands.length} slash commands.`);
  } catch (err) {
    console.error("[Commands Error] Failed to register slash commands:", err.message);
  }
}

// ============================================================================
// 7. Interaction Handlers (Slash Commands & Autocomplete)
// ============================================================================

client.on(Events.InteractionCreate, async (interaction) => {
  // Autocomplete Handler
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);

    // 1. Vault note autocomplete (study, quiz, write)
    if (focused.name === "note") {
      try {
        const notes = await getVaultNotes();
        const query = focused.value.toLowerCase();
        const filtered = notes
          .filter((n) => n.toLowerCase().includes(query))
          .slice(0, 25);

        await interaction.respond(
          filtered.map((n) => {
            const displayName = n.length > 100 ? "..." + n.slice(-97) : n;
            let val = n;
            if (val.length > 100) {
              const idx = notes.indexOf(n);
              val = `@idx:${idx}`;
            }
            return { name: displayName, value: val };
          })
        );
      } catch (autoErr) {
        console.error("[Autocomplete Error]:", autoErr.message);
        await interaction.respond([]);
      }
      return;
    }

    // 2. Persona autocomplete (/persona switch)
    if (focused.name === "name" && interaction.commandName === "persona") {
      try {
        const files = await fg([path.join(PERSONAS_DIR, "*.md").replace(/\\/g, "/")], { onlyFiles: true });
        const query = focused.value.toLowerCase();
        const personas = files
          .map((f) => path.basename(f, ".md"))
          .filter((slug) => slug.toLowerCase().includes(query))
          .slice(0, 25);

        await interaction.respond(
          personas.map((slug) => ({ name: slug, value: slug }))
        );
      } catch (autoErr) {
        console.error("[Persona Autocomplete Error]:", autoErr.message);
        await interaction.respond([]);
      }
      return;
    }

    // 3. Memo autocomplete (/memo append, /memo read)
    if (focused.name === "memo" && interaction.commandName === "memo") {
      try {
        const files = await fg([path.join(MEMO_DIR, "*.md").replace(/\\/g, "/")], { onlyFiles: true });
        const query = focused.value.toLowerCase();
        const memos = files
          .map((f) => path.basename(f, ".md"))
          .filter((slug) => slug.toLowerCase().includes(query))
          .slice(0, 25);

        await interaction.respond(
          memos.map((slug) => ({ name: slug, value: slug }))
        );
      } catch (autoErr) {
        console.error("[Memo Autocomplete Error]:", autoErr.message);
        await interaction.respond([]);
      }
      return;
    }

    return;
  }

  // Slash Command Dispatcher
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // /roast
  if (commandName === "roast") {
    await interaction.deferReply();
    try {
      const stats = await getDailyScheduleStats();
      if (!stats) {
        await interaction.editReply("you haven't even made today's daily note yet... wake up 💀");
        return;
      }

      const roastPrompt = [
        `stats for today's daily schedule (${stats.date}):`,
        `- total tasks: ${stats.totalCount}`,
        `- completed tasks: ${stats.checkedCount}`,
        `- pending tasks: ${stats.uncheckedCount}`,
        stats.wakeTime ? `- woke up at: ${stats.wakeTime}` : null,
        stats.sampleTasks ? `- sample tasks: ${stats.sampleTasks}` : null,
        `give a flat, dry, 1-2 sentence reality check roasting my progress today.`
      ].filter(Boolean).join("\n");

      const activePersona = await loadActivePersona();
      const reply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: roastPrompt },
      ]);

      await interaction.editReply(reply);
    } catch (err) {
      console.error("[Roast Error]:", err.message);
      await interaction.editReply("couldn't roast your schedule right now... the api died 💀");
    }
    return;
  }

  // /study
  if (commandName === "study") {
    await interaction.deferReply();
    const noteInput = interaction.options.getString("note", true);
    const topic = interaction.options.getString("topic", true);

    try {
      const fullPath = resolveNotePath(noteInput);
      const content = await fs.readFile(fullPath, "utf-8");

      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const topicRegex = new RegExp(`#{1,6}\\s+[^\\n]*${escapeRegex(topic)}[^\\n]*`, "i");
      const topicMatch = topicRegex.exec(content);

      let excerpt = content;
      if (topicMatch) {
        excerpt = content.slice(topicMatch.index, topicMatch.index + 3500);
      } else if (content.length > 3500) {
        excerpt = content.slice(0, 3500);
      }

      const studyPrompt = [
        `topic: "${topic}"`,
        `note context (${path.basename(fullPath)}):`,
        excerpt,
        `explain this with an intuitive analogy and a concise mental model in 1-2 sentences.`
      ].join("\n\n");

      const activePersona = await loadActivePersona();
      const reply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: studyPrompt },
      ]);

      await interaction.editReply(reply);
    } catch (err) {
      console.error("[Study Error]:", err.message);
      await interaction.editReply(`couldn't study that note... ${err.message.toLowerCase()} 💀`);
    }
    return;
  }

  // /quiz
  if (commandName === "quiz") {
    await interaction.deferReply();
    const noteInput = interaction.options.getString("note", true);

    try {
      const fullPath = resolveNotePath(noteInput);
      const content = await fs.readFile(fullPath, "utf-8");
      const excerpt = content.slice(0, 3500);

      const quizPrompt = [
        `note content (${path.basename(fullPath)}):`,
        excerpt,
        `generate 1 conceptual question and 1 practical coding test or scenario based on this note.`,
        `include the expected criteria for evaluating the answer inside <criteria>...</criteria> tags.`,
        `format the questions cleanly in 2-3 short lines.`
      ].join("\n\n");

      const activePersona = await loadActivePersona();
      const rawReply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: quizPrompt },
      ]);

      const criteriaMatch = rawReply.match(/<criteria>([\s\S]*?)<\/criteria>/i);
      const expectedCriteria = criteriaMatch
        ? criteriaMatch[1].trim()
        : "accurate technical reasoning based on the note";

      const displayQuiz = sanitizeSpeech(
        rawReply.replace(/<criteria>[\s\S]*?<\/criteria>/gi, "")
      ).trim();

      // Evict any existing quiz for this user
      if (activeQuizzes.has(interaction.user.id)) {
        clearTimeout(activeQuizzes.get(interaction.user.id).timeoutId);
      }

      // Enforce 15-minute TTL
      const timeoutId = setTimeout(() => {
        if (activeQuizzes.has(interaction.user.id)) {
          activeQuizzes.delete(interaction.user.id);
          console.log(`[Quiz] Evicted expired quiz for user ${interaction.user.id}`);
        }
      }, 15 * 60 * 1000);

      activeQuizzes.set(interaction.user.id, {
        expectedCriteria,
        notePath: path.relative(VAULT_PATHS.root, fullPath),
        timestamp: Date.now(),
        channelId: interaction.channelId,
        timeoutId,
      });

      await interaction.editReply(displayQuiz);
    } catch (err) {
      console.error("[Quiz Error]:", err.message);
      await interaction.editReply(`failed to generate quiz... ${err.message.toLowerCase()} 💀`);
    }
    return;
  }

  // /write
  if (commandName === "write") {
    await interaction.deferReply();
    const noteInput = interaction.options.getString("note", true);
    const section = interaction.options.getString("section", true);
    const text = interaction.options.getString("text", true);

    try {
      const { fullPath } = await insertIntoSection(noteInput, section, text);
      const noteName = path.basename(fullPath);
      await interaction.editReply(
        `added task to "${section}" in ${noteName}... now actually do it.`
      );
    } catch (err) {
      console.error("[Write Error]:", err.message);
      await interaction.editReply(
        `couldn't write task... ${err.message.toLowerCase()} 💀`
      );
    }
    return;
  }

  // /happenings
  if (commandName === "happenings") {
    await interaction.deferReply();
    const limit = interaction.options.getInteger("limit") || 10;
    const channelIds = (LOG_CHANNELS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (channelIds.length === 0) {
      await interaction.editReply("no log channels configured in .env... nothing to digest 💀");
      return;
    }

    try {
      const logs = [];
      for (const chId of channelIds) {
        try {
          const ch = await client.channels.fetch(chId).catch(() => null);
          if (ch && ch.isTextBased()) {
            const messages = await ch.messages.fetch({ limit: Math.min(limit, 50) });
            const userMsgs = messages
              .filter((m) => !m.author.bot && m.cleanContent)
              .map((m) => `${m.author.username}: ${m.cleanContent}`);
            userMsgs.reverse();
            if (userMsgs.length > 0) {
              logs.push(`[channel: #${ch.name}]\n${userMsgs.join("\n")}`);
            }
          }
        } catch (fetchErr) {
          console.warn(`[Happenings] Could not fetch channel ${chId}:`, fetchErr.message);
        }
      }

      if (logs.length === 0) {
        await interaction.editReply("scanned the channels... literally complete radio silence 💀");
        return;
      }

      const digestPrompt = [
        `recent channel activity logs:`,
        logs.join("\n\n"),
        `give a deadpan, 1-2 sentence summary of what's happening.`
      ].join("\n\n");

      const activePersona = await loadActivePersona();
      const reply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: digestPrompt },
      ]);

      await interaction.editReply(reply);
    } catch (err) {
      console.error("[Happenings Error]:", err.message);
      await interaction.editReply("failed to summarize happenings... the api choked 💀");
    }
    return;
  }

  // /joke
  if (commandName === "joke") {
    await interaction.deferReply();
    const topic = interaction.options.getString("topic") || "programming, computer science, or studying";

    try {
      const activePersona = await loadActivePersona();
      const jokePrompt = `tell a dry, witty, 1-2 sentence developer or student joke about: ${topic}.`;

      const reply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: jokePrompt },
      ]);

      await interaction.editReply(reply);
    } catch (err) {
      console.error("[Joke Error]:", err.message);
      await interaction.editReply("tried to tell a joke but my humor module crashed 💀");
    }
    return;
  }

  // /persona
  if (commandName === "persona") {
    const sub = interaction.options.getSubcommand();
    if (sub === "switch") {
      await interaction.deferReply();
      const targetName = interaction.options.getString("name", true).trim().toLowerCase();
      const targetFile = path.resolve(PERSONAS_DIR, `${targetName}.md`);

      try {
        await fs.access(targetFile);
        activePersonaSlug = targetName;
        const newPersona = await loadActivePersona();

        const switchPrompt = `system update: persona switched to "${targetName}". introduce yourself briefly and confirm the switch in 1-2 sentences strictly adhering to your new voice and tone.`;
        const reply = await generateInference([
          { role: "system", content: newPersona },
          { role: "user", content: switchPrompt },
        ]);

        await interaction.editReply(reply);
      } catch (err) {
        console.error("[Persona Switch Error]:", err.message);
        await interaction.editReply(
          `persona "${targetName}" doesn't exist in ${PERSONAS_DIR}. check /persona switch autocomplete 💀`
        );
      }
      return;
    }
  }

  // /memo
  if (commandName === "memo") {
    const sub = interaction.options.getSubcommand();

    // /memo create
    if (sub === "create") {
      await interaction.deferReply();
      const title = interaction.options.getString("title", true).trim();
      const text = interaction.options.getString("text", true).trim();

      try {
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "untitled-memo";

        const memoPath = path.resolve(MEMO_DIR, `${slug}.md`);
        if (!memoPath.startsWith(MEMO_DIR)) {
          throw new Error("security exception: invalid memo filename.");
        }

        const dateStr = formatDateString(new Date());
        const timeStr = formatTimeString(new Date());
        const sanitizedEntry = text.replace(/^#+\s*/, "").trim();

        const frontmatter = {
          title,
          created: dateStr,
          updated: dateStr,
          tags: ["memo"],
        };
        const body = `# Notes\n\n- [ ] ${timeStr} — ${sanitizedEntry}\n`;
        const fileContent = matter.stringify(body, frontmatter);

        const tmpPath = `${memoPath}.tmp`;
        await fs.writeFile(tmpPath, fileContent, "utf-8");
        await fs.rename(tmpPath, memoPath);

        await interaction.editReply(`created memo **${slug}.md** and logged initial entry.`);
      } catch (err) {
        console.error("[Memo Create Error]:", err.message);
        await interaction.editReply(`failed to create memo: ${err.message.toLowerCase()} 💀`);
      }
      return;
    }

    // /memo append
    if (sub === "append") {
      await interaction.deferReply();
      const memoInput = interaction.options.getString("memo", true).trim();
      const text = interaction.options.getString("text", true).trim();

      try {
        const slug = memoInput.endsWith(".md")
          ? path.basename(memoInput, ".md")
          : memoInput;
        const memoPath = path.resolve(MEMO_DIR, `${slug}.md`);

        if (!memoPath.startsWith(MEMO_DIR)) {
          throw new Error("security exception: invalid memo path.");
        }

        await fs.access(memoPath);

        const raw = await fs.readFile(memoPath, "utf-8");
        const parsed = matter(raw);
        const data = parsed.data || {};

        const dateStr = formatDateString(new Date());
        const timeStr = formatTimeString(new Date());
        const sanitizedEntry = text.replace(/^#+\s*/, "").trim();
        const newEntry = `- [ ] ${timeStr} — ${sanitizedEntry}`;

        data.title = data.title || slug;
        data.created = data.created || dateStr;
        data.updated = dateStr;
        data.tags = Array.isArray(data.tags) ? data.tags : ["memo"];

        let body = parsed.content;
        const notesMatch = /(#{1,6}\s+Notes[^\n]*\n)/i.exec(body);
        if (notesMatch) {
          const insertPos = notesMatch.index + notesMatch[0].length;
          body = `${body.slice(0, insertPos)}${newEntry}\n${body.slice(insertPos)}`;
        } else {
          body = `${body.trim()}\n\n# Notes\n\n${newEntry}\n`;
        }

        const updatedDoc = matter.stringify(body.trim() + "\n", data);
        const tmpPath = `${memoPath}.tmp`;
        await fs.writeFile(tmpPath, updatedDoc, "utf-8");
        await fs.rename(tmpPath, memoPath);

        await interaction.editReply(`appended task to **${slug}.md**.`);
      } catch (err) {
        console.error("[Memo Append Error]:", err.message);
        await interaction.editReply(`couldn't append to memo: ${err.message.toLowerCase()} 💀`);
      }
      return;
    }

    // /memo read
    if (sub === "read") {
      await interaction.deferReply();
      const memoInput = interaction.options.getString("memo", true).trim();

      try {
        const slug = memoInput.endsWith(".md")
          ? path.basename(memoInput, ".md")
          : memoInput;
        const memoPath = path.resolve(MEMO_DIR, `${slug}.md`);

        if (!memoPath.startsWith(MEMO_DIR)) {
          throw new Error("security exception: invalid memo path.");
        }

        await fs.access(memoPath);

        const raw = await fs.readFile(memoPath, "utf-8");
        const { data, content } = matter(raw);

        const titleDisplay = data.title || slug;
        const updatedDisplay = data.updated || "unknown";
        const header = `📝 **Memo: ${titleDisplay}** (Updated: ${updatedDisplay})\n`;
        const fullMessage = `${header}\n${content.trim()}`;

        if (fullMessage.length > 1900) {
          await interaction.editReply(`${fullMessage.slice(0, 1850)}\n\n*...[truncated]*`);
        } else {
          await interaction.editReply(fullMessage || "*(empty memo)*");
        }
      } catch (err) {
        console.error("[Memo Read Error]:", err.message);
        await interaction.editReply(`couldn't read memo: ${err.message.toLowerCase()} 💀`);
      }
      return;
    }
  }
});

// ============================================================================
// 8. Giphy Reaction Engine & Multimodal Vision Pipeline
// ============================================================================

/**
 * Searches Giphy API for a single relevant GIF matching query.
 */
async function fetchReactionGif(query) {
  if (!GIPHY_API_KEY || !query) return null;
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=1&rating=pg-13`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.[0]?.images?.original?.url || null;
  } catch (err) {
    console.warn(`[Giphy] Search failed for "${query}":`, err.message);
    return null;
  }
}

/**
 * Inspects image attachment using configured vision model.
 */
async function inspectImageAttachment(attachment) {
  if (!attachment || !attachment.contentType) return null;
  const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
  const sanitizedType = attachment.contentType.split(";")[0].toLowerCase();
  if (!validTypes.includes(sanitizedType)) return null;

  try {
    console.log(`[Vision] Inspecting attachment: ${attachment.url}`);
    const visionResponse = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Concisely describe this meme or image in 1-2 dry sentences from the perspective of an observant, witty Gen Z peer. Focus on funny, weird, or pathetic details.",
            },
            {
              type: "image_url",
              image_url: { url: attachment.url },
            },
          ],
        },
      ],
      max_tokens: 150,
      temperature: 0.5,
    });

    return visionResponse.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error(`[Vision Error]:`, err.message);
    return null;
  }
}

/**
 * Helper to dispatch replies with optional Giphy reactions.
 */
async function dispatchReply(message, replyText, options = {}) {
  let finalContent = replyText;
  const gifMatch = replyText.match(/<gif>(.*?)<\/gif>/i);
  if (gifMatch) {
    const query = gifMatch[1].trim();
    finalContent = replyText.replace(/<gif>.*?<\/gif>/gi, "").trim();
    const gifUrl = await fetchReactionGif(query);
    if (gifUrl) {
      finalContent = `${finalContent}\n${gifUrl}`;
    }
  }

  return await message.reply({
    content: finalContent,
    ...options,
  });
}

// ============================================================================
// 9. Hybrid Mention & Message Listener
// ============================================================================

client.on(Events.MessageCreate, async (message) => {
  // Ignore messages from bots (including self)
  if (message.author.bot) return;

  // Check trigger conditions: explicit @mention or direct reply to bot message
  const isMentioned = message.mentions.users.has(client.user.id);
  let isReplyToBot = false;

  if (message.reference && message.reference.messageId) {
    try {
      const referenced = await message.channel.messages.fetch(message.reference.messageId);
      if (referenced && referenced.author.id === client.user.id) {
        isReplyToBot = true;
      }
    } catch (fetchErr) {
      // Ignored: Message might have been deleted or inaccessible in cache
    }
  }

  if (!isMentioned && !isReplyToBot) {
    return;
  }

  // Curated in-character reaction emoji (fire-and-forget)
  const REACTIONS = ["☕", "💀", "👀", "🫡", "😭", "🔥"];
  const chosenReaction = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
  message.react(chosenReaction).catch((err) => {
    console.warn(`[Reaction Error]: Could not react with ${chosenReaction}:`, err.message);
  });

  // Strip bot mention tag from text content
  const mentionRegex = new RegExp(`<@!?${client.user.id}>`, "g");
  let cleanUserText = message.content.replace(mentionRegex, "").trim();

  // Inspect image attachment if present
  const firstAttachment = message.attachments.first();
  const visualSummary = await inspectImageAttachment(firstAttachment);
  if (visualSummary) {
    cleanUserText = cleanUserText
      ? `${cleanUserText}\n\n[mocha looks at the image: ${visualSummary}]`
      : `[mocha looks at the image: ${visualSummary}]`;
  }

  // Maintain periodic typing indicator during inference
  const triggerTyping = async () => {
    try {
      await message.channel.sendTyping();
    } catch (err) {}
  };

  await triggerTyping();
  const typingTimer = setInterval(triggerTyping, 8000);

  try {
    const activePersona = await loadActivePersona();

    // Stage 1: Intercept active quiz responses
    if (activeQuizzes.has(message.author.id)) {
      const quiz = activeQuizzes.get(message.author.id);
      clearTimeout(quiz.timeoutId);
      activeQuizzes.delete(message.author.id);

      const evalPrompt = [
        `quiz evaluation:`,
        `- target note: ${quiz.notePath}`,
        `- expected criteria: ${quiz.expectedCriteria}`,
        `- user answer: "${cleanUserText}"`,
        `evaluate this answer in 1-2 deadpan sentences. validate solid reasoning or dryly roast flaws.`
      ].join("\n\n");

      const reply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: evalPrompt },
      ]);

      await dispatchReply(message, reply, {
        allowedMentions: { repliedUser: true },
      });
      return;
    }

    // Stage 2: Automatic Schedule / Cooked status inquiry detection
    const isAskingSchedule =
      /(?:schedule|tasks?|to-?do|cooked|doing\s+good|am\s+i\s+cooked)/i.test(cleanUserText);

    if (isAskingSchedule) {
      const stats = await getDailyScheduleStats();
      if (!stats) {
        await message.reply({
          content: "you haven't even made today's daily note yet... wake up 💀",
          allowedMentions: { repliedUser: true },
        });
        return;
      }

      const roastPrompt = [
        `stats for today's daily schedule (${stats.date}):`,
        `- total tasks: ${stats.totalCount}`,
        `- completed tasks: ${stats.checkedCount}`,
        `- pending tasks: ${stats.uncheckedCount}`,
        stats.wakeTime ? `- woke up at: ${stats.wakeTime}` : null,
        stats.sampleTasks ? `- sample tasks: ${stats.sampleTasks}` : null,
        `user question: "${cleanUserText}"`,
        `give a flat, dry, 1-2 sentence reality check roasting my progress today.`
      ].filter(Boolean).join("\n");

      const reply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: roastPrompt },
      ]);

      await dispatchReply(message, reply, {
        allowedMentions: { repliedUser: true },
      });
      return;
    }

    // Stage 3: General Conversational Partner with Sliding Buffer
    const channelHistory = getChannelHistory(message.channelId);
    const conversationPayload = [
      { role: "system", content: activePersona },
      ...channelHistory,
      { role: "user", content: cleanUserText || "hey" },
    ];

    const reply = await generateInference(conversationPayload);
    appendToChannelHistory(message.channelId, cleanUserText || "hey", reply);

    await dispatchReply(message, reply, {
      allowedMentions: { repliedUser: true },
    });
  } catch (error) {
    console.error("[MessageCreate Error]:", error);
    try {
      await message.reply({
        content: "my brain is completely fried right now... try again in a bit 💀",
        allowedMentions: { repliedUser: false },
      });
    } catch (sendErr) {
      console.error("[MessageCreate Error] Failed to dispatch error message:", sendErr.message);
    }
  } finally {
    clearInterval(typingTimer);
  }
});

// ============================================================================
// 10. Automated Midnight Debrief Engine
// ============================================================================

let lastDebriefDate = null;

/**
 * Checks if current time is within the midnight window (00:00 - 00:01).
 * Parses yesterday's schedule note, prompts for a debrief, sends to Discord,
 * and archives markdown report to ./mocha-vault/debriefs/${yesterdayStr}-debrief.md.
 */
async function checkMidnightDebrief() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const todayStr = formatDateString(now);

  // Trigger window: between 00:00 and 00:01 once per calendar day
  if ((hours === 0 && (minutes === 0 || minutes === 1)) && lastDebriefDate !== todayStr) {
    lastDebriefDate = todayStr;
    console.log(`[Midnight Debrief] Triggered debrief execution for ${todayStr}...`);

    try {
      // Calculate yesterday's date
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = formatDateString(yesterday);

      // Locate yesterday's daily schedule note
      const pattern = path.join(VAULT_PATHS.dailySchedules, `${yesterdayStr}*.md`).replace(/\\/g, "/");
      const matches = await fg([pattern], { onlyFiles: true });

      if (matches.length === 0) {
        console.log(`[Midnight Debrief] No schedule note found for ${yesterdayStr}. Skipping.`);
        return;
      }

      const schedulePath = matches[0];
      const content = await fs.readFile(schedulePath, "utf-8");

      const checked = (content.match(/^\s*-\s*\[[xX]\]\s*([^\n]+)/gm) || []).map((t) => t.trim());
      const unchecked = (content.match(/^\s*-\s*\[\s*\]\s*([^\n]+)/gm) || []).map((t) => t.trim());
      const wakeMatch = content.match(/woke\s+up\s+at:\s*([^\n]+)/i);
      const wakeTime = wakeMatch ? wakeMatch[1].replace(/\*/g, "").trim() : null;

      // Extract # UPDATE or ## UPDATE section if present
      const updateMatch = content.match(/#{1,6}\s+update[^\n]*\n([\s\S]*?)(?=(?:^#{1,6}\s+|$))/im);
      const updateText = updateMatch ? updateMatch[1].trim() : "none";

      const debriefPrompt = [
        `daily schedule review for yesterday (${yesterdayStr}):`,
        `- total completed tasks: ${checked.length}`,
        `- missed/pending tasks: ${unchecked.length}`,
        wakeTime ? `- wake time: ${wakeTime}` : null,
        `- sample completed: ${checked.slice(0, 6).join(", ") || "none"}`,
        `- sample missed: ${unchecked.slice(0, 6).join(", ") || "none"}`,
        `- daily update log: ${updateText}`,
        `provide a midnight debrief roasting my failures, acknowledging what was done, and giving 1 concrete priority for today. keep it punchy (2-3 sentences max).`
      ].filter(Boolean).join("\n");

      const activePersona = await loadActivePersona();
      const debriefReply = await generateInference([
        { role: "system", content: activePersona },
        { role: "user", content: debriefPrompt },
      ]);

      // Post to primary log channel
      const primaryChannelId = (LOG_CHANNELS || "").split(",")[0]?.trim();
      if (primaryChannelId) {
        try {
          const ch = await client.channels.fetch(primaryChannelId).catch(() => null);
          if (ch && ch.isTextBased()) {
            await ch.send(`🌙 **midnight debrief — ${yesterdayStr}**\n\n${debriefReply}`);
            console.log(`[Midnight Debrief] Dispatched to channel ${primaryChannelId}.`);
          }
        } catch (chErr) {
          console.error(`[Midnight Debrief] Failed to send to channel ${primaryChannelId}:`, chErr.message);
        }
      }

      // Archive debrief to ./mocha-vault/debriefs/${yesterdayStr}-debrief.md
      const debriefFilename = `${yesterdayStr}-debrief.md`;
      const debriefPath = path.join(DEBRIEFS_DIR, debriefFilename);
      const debriefDoc = [
        "---",
        `date: "${yesterdayStr}"`,
        `completed_tasks: ${checked.length}`,
        `missed_tasks: ${unchecked.length}`,
        `generated_at: "${now.toISOString()}"`,
        `persona: "${activePersonaSlug}"`,
        "---",
        "",
        `# Midnight Debrief — ${yesterdayStr}`,
        "",
        debriefReply,
        "",
      ].join("\n");

      const tmpDebriefPath = `${debriefPath}.tmp`;
      await fs.writeFile(tmpDebriefPath, debriefDoc, "utf-8");
      await fs.rename(tmpDebriefPath, debriefPath);
      console.log(`[Midnight Debrief] Archived debrief to ${debriefPath}`);
    } catch (err) {
      console.error("[Midnight Debrief Error]:", err.message);
    }
  }
}

// ============================================================================
// 11. Process Lifecycle & Client Ready Initialization
// ============================================================================

client.once(Events.ClientReady, async () => {
  console.log("==================================================");
  console.log(`[Gateway] Mocha El Copiloto online! Logged in as ${client.user.tag}`);
  console.log(`[Vault] Root: ${VAULT_PATHS.root}`);
  console.log(`[Vault] Daily: ${VAULT_PATHS.dailySchedules}`);
  console.log(`[Vault] Main: ${VAULT_PATHS.mainNotes}`);
  console.log(`[Vault] School: ${VAULT_PATHS.schoolNotes}`);
  console.log(`[Model] Primary: ${cleanModel} | Vision: ${VISION_MODEL}`);

  // Dynamic runtime model discovery
  await updateLiveFreeModels();
  console.log(
    `[Model Cascade] Pool (${liveFreeModels.length} models): ${liveFreeModels.slice(0, 5).join(" -> ")}...`
  );

  // Pre-index vault notes
  const notes = await getVaultNotes();
  console.log(`[Vault Index] Indexed ${notes.length} markdown notes.`);

  // Deploy slash commands
  await deploySlashCommands();

  // Start automated midnight debrief interval (every 60 seconds)
  setInterval(checkMidnightDebrief, 60 * 1000);
  console.log("[Scheduler] Automated midnight debrief engine running (60s tick).");

  console.log("==================================================");
});

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception:", error);
});

// Login Bot to Discord Gateway
client.login(DISCORD_BOT_TOKEN);
