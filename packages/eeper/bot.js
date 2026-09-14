import { Client, GatewayIntentBits, Partials } from "discord.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables from .env
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 1. Environment & Client Verification
// ============================================================================

const {
  DISCORD_BOT_TOKEN,
  OPENROUTER_API_KEY,
  BEBU_DISCORD_ID,
  BEBU_ID,
  MEMORY_DIR_PATH = path.join(__dirname, "eeper-memory"),
  VISION_MODEL = "openrouter/free",
} = process.env;

// 1. Defensive string parsing (prevents env malformation like LLM_MODEL='LLM_MODEL="openrouter/free"')
const rawModel = process.env.LLM_MODEL || "openrouter/free";
const cleanModel =
  rawModel
    .replace(/^LLM_MODEL\s*=\s*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim() || "openrouter/free";

// 2. Dynamic Runtime Free Tier Model Discovery
let liveFreeModels = ["openrouter/free"];

async function updateLiveFreeModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // Filter for free text-generation models
    const freeTextModels = (json.data || [])
      .filter((m) => {
        const isFree =
          m.id.endsWith(":free") ||
          (m.pricing &&
            parseFloat(m.pricing.prompt) === 0 &&
            parseFloat(m.pricing.completion) === 0);

        // Exclude embeddings, audio/TTS, and safety moderators
        const isExcluded = /embed|tts|rerank|safety|audio/i.test(m.id);
        return isFree && !isExcluded;
      })
      .map((m) => m.id);

    // Prioritize high-quality known anchors, then openrouter/free, then the rest
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
    console.warn(`[Engine] Failed to fetch live model catalog (${err.message}). Using fallback anchors.`);
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

const LLM_MODEL = cleanModel;
const TARGET_BEBU_ID = BEBU_DISCORD_ID || BEBU_ID;

if (!DISCORD_BOT_TOKEN) {
  console.error("CRITICAL: DISCORD_BOT_TOKEN is not defined in environment.");
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.error("CRITICAL: OPENROUTER_API_KEY is not defined in environment.");
  process.exit(1);
}

// Initialize OpenRouter client via OpenAI Node.js SDK
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  timeout: 30000,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/frtzhahn/mocha-automata",
    "X-Title": "Eeper Discord Companion",
  },
});

// Initialize Discord Gateway Client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Gateway connection error handling
client.on("error", (err) => console.error("[Gateway Error]:", err));
client.on("shardError", (err, shardId) => console.error(`[Shard ${shardId} Error]:`, err));

// ============================================================================
// 2. In-Memory Sliding Context (Max 10 messages per channel)
// ============================================================================

/**
 * Map of channelId -> Array<{ role: "user" | "assistant", content: string }>
 * Retains up to 10 short-term messages to provide conversational continuity.
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

  // Evict older messages when exceeding maximum sliding window size
  while (history.length > MAX_CONTEXT_ITEMS) {
    history.shift();
  }
}

// ============================================================================
// 3. Dynamic Persona & Markdown Loading (Obsidian Live Integration)
// ============================================================================

/**
 * Reads persona and relationship markdown files on every incoming trigger.
 * This allows real-time edits in Obsidian to immediately take effect without
 * restarting the Node.js process.
 */
async function loadDynamicSystemPrompt(authorId) {
  const resolvedMemoryDir = path.resolve(MEMORY_DIR_PATH);
  const personaFile = path.join(resolvedMemoryDir, "persona.md");
  
  // Differentiate between Bebu (Mommy) and regular server members
  const isBebu = TARGET_BEBU_ID && authorId === TARGET_BEBU_ID;
  const relationshipFile = path.join(
    resolvedMemoryDir,
    isBebu ? "bebu.md" : "server.md"
  );

  let personaContent = "";
  let relationshipContent = "";

  try {
    personaContent = await fs.readFile(personaFile, "utf-8");
  } catch (err) {
    console.warn(`[Memory] Unable to read ${personaFile}: ${err.message}. Using default persona.`);
    personaContent = "You are Eeper, a sweet, sleepy house cat who loves purring and napping.";
  }

  try {
    relationshipContent = await fs.readFile(relationshipFile, "utf-8");
  } catch (err) {
    console.warn(`[Memory] Unable to read ${relationshipFile}: ${err.message}. Using fallback relationship.`);
    relationshipContent = isBebu
      ? "This user is your beloved Mommy (Bebu). You are deeply affectionate and devoted to her."
      : "This user is a server companion. You are friendly, gentle, and polite.";
  }

  return [
    personaContent.trim(),
    relationshipContent.trim(),
    "### Feline Response Rules",
    "- Always stay strictly in character as Eeper the cat.",
    "- Keep responses warm, succinct (1-3 sentences), and feline.",
    "- Use light markdown actions (*purrs*, *kneads*, *blinks slowly*).",
    "- CRITICAL: Speak directly as Eeper. Do NOT draft, outline, or explain your thinking process.",
    "- Begin output immediately with your dialogue/action. Output ONLY in-character dialogue or actions.",
  ].join("\n\n");
}

// ============================================================================
// 4. Multimodal Vision Pipeline (Llama 3.2 11B Vision)
// ============================================================================

/**
 * Analyzes image attachments using OpenRouter's vision model from an observant
 * cat's perspective, injecting a succinct visual summary into the prompt context.
 */
async function inspectImageAttachment(attachment) {
  if (!attachment || !attachment.contentType) return null;

  const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  const sanitizedType = attachment.contentType.split(";")[0].toLowerCase();

  if (!validTypes.includes(sanitizedType)) {
    return null;
  }

  try {
    console.log(`[Vision] Processing image attachment: ${attachment.url}`);
    const visionResponse = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Concisely describe what is shown in this picture from the eyes of a sleepy, observant house cat. Notice cozy spots, hands, food, shapes, or humans. Limit response to 1-2 sentences.",
            },
            {
              type: "image_url",
              image_url: {
                url: attachment.url,
              },
            },
          ],
        },
      ],
      max_tokens: 120,
      temperature: 0.5,
    });

    const description = visionResponse.choices[0]?.message?.content?.trim();
    if (description) {
      console.log(`[Vision] Summary generated: "${description}"`);
      return description;
    }
  } catch (visionErr) {
    console.error(`[Vision Error] Failed to process image with vision model: ${visionErr.message}`);
  }

  return "an unreadable or blurry image";
}

// ============================================================================
// 5. Speech Sanitizer & Multi-Model Inference Cascade
// ============================================================================

/**
 * Strips internal model reasoning tokens (<think>, <thought>), markdown fences,
 * and conversational preambles from generated speeches.
 */
function sanitizeSpeech(rawText) {
  if (!rawText) return "";
  let clean = rawText
    // 1. Strip XML-style reasoning blocks (even if unclosed at end of string)
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, "")
    .replace(/<details.*?>[\s\S]*?(?:<\/details>|$)/gi, "")

    // 2. Strip plain-text thinking processes (e.g., "Here's a thinking process: ...")
    .replace(
      /(?:Here'?s a thinking process|Thinking process|Drafting - Attempt \d+)[\s\S]*?(?=(?:(?:\n\n|\r\n\r\n)[A-Z"'\*]|Word count check:|$))/gi,
      ""
    )
    .replace(/Word count check:.*$/gmi, "")
    .replace(/Word count:.*?(?:Perfect\.|\n|$)/gmi, "")

    // 3. Strip code fences
    .replace(/^```[a-z]*\n([\s\S]*?)\n```$/gi, "$1")

    // 4. Strip conversational preambles
    .replace(
      /^(Here is (my|the)|As (an AI|[A-Z][a-zA-Z\s]+),|Round \d+:|My (thesis|antithesis|rebuttal|response|opening):).*?\n+/i,
      ""
    )
    .trim();

  // Strip wrapping quotes
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1).trim();
  }

  return clean;
}

/**
 * Dispatches an inference request through the dynamic free tier cascade with retries and failover.
 */
async function generateEeperReply(conversationPayload) {
  const maxRetries = 2;

  for (const model of liveFreeModels) {
    let modelFailed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model,
          messages: conversationPayload,
          temperature: 0.7,
          max_tokens: 1200,
        });

        const rawReply = completion?.choices?.[0]?.message?.content;
        const cleanReply = sanitizeSpeech(rawReply);
        if (cleanReply) {
          return cleanReply;
        }

        console.warn(
          `[Cascade Failover] Model ${model} failed (empty completion content). Trying next fallback model...`
        );
        modelFailed = true;
        break;
      } catch (err) {
        const status = err.status || err.statusCode || err.response?.status;

        // 400 (invalid ID/payload) or 404 (model deprecated/unavailable): fail over immediately
        if (status === 400 || status === 404) {
          console.warn(
            `[Cascade Failover] Model ${model} failed (${err.message}). Trying next fallback model...`
          );
          modelFailed = true;
          break;
        }

        // Fatal authentication errors (401, 402)
        if (status === 401 || status === 402) {
          console.error(`[Inference Auth Failure] HTTP ${status}: ${err.message}`);
          throw new Error(`HTTP ${status} (${err.message})`);
        }

        // Network drops or 429 rate limits
        console.warn(
          `[Inference Error] Model ${model} attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}`
        );

        if (attempt < maxRetries) {
          console.warn(`[Inference Retry] Retrying ${model} in 2000ms...`);
          await new Promise((res) => setTimeout(res, 2000));
        } else {
          console.warn(
            `[Cascade Failover] Model ${model} failed (${err.message}). Trying next fallback model...`
          );
          modelFailed = true;
        }
      }
    }

    if (modelFailed) {
      continue;
    }
  }

  throw new Error("All free tier models in the fallback cascade are temporarily unavailable.");
}

// ============================================================================
// 6. Text Chunking Utility (Discord 2000-char boundary safety)
// ============================================================================

/**
 * Splits a response into chunks under 1900 characters, respecting newline
 * or space boundaries to avoid breaking Discord message transmission limits.
 */
function splitMessageContent(text, limit = 1900) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", limit);
    if (splitIndex === -1 || splitIndex < limit / 2) {
      splitIndex = remaining.lastIndexOf(" ", limit);
    }
    if (splitIndex === -1) {
      splitIndex = limit;
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

// ============================================================================
// 7. Gateway Event Handlers
// ============================================================================

client.once("clientReady", async () => {
  console.log("==================================================");
  console.log(`[Gateway] Eeper online! Logged in as ${client.user.tag}`);
  console.log(`[Memory] Dynamic vault directory: ${path.resolve(MEMORY_DIR_PATH)}`);
  console.log(`[Target] Configured Bebu ID: ${TARGET_BEBU_ID || "(None set)"}`);
  console.log(`[Model] Primary: ${cleanModel} | Vision: ${VISION_MODEL}`);

  // Dynamic runtime model discovery via OpenRouter API
  await updateLiveFreeModels();

  console.log(
    `[Model Cascade] Pool (${liveFreeModels.length} models): ${liveFreeModels.slice(0, 5).join(" -> ")}...`
  );
  console.log("==================================================");
});

client.on("messageCreate", async (message) => {
  // Ignore messages from bots (including self)
  if (message.author.bot) return;

  // Verify trigger conditions:
  // 1. Bot is explicitly @mentioned
  // 2. Message is a direct reply referencing one of the bot's messages
  const isMentioned = message.mentions.users.has(client.user.id);
  let isReplyToBot = false;

  if (message.reference && message.reference.messageId) {
    try {
      const referenced = await message.channel.messages.fetch(message.reference.messageId);
      if (referenced && referenced.author.id === client.user.id) {
        isReplyToBot = true;
      }
    } catch (fetchErr) {
      // Ignored: Message might have been deleted or inaccessible in channel cache
    }
  }

  // If neither condition is met, silently ignore
  if (!isMentioned && !isReplyToBot) {
    return;
  }

  // Strip bot mention tag from text content
  const mentionRegex = new RegExp(`<@!?${client.user.id}>`, "g");
  const cleanUserText = message.content.replace(mentionRegex, "").trim();

  // Maintain periodic typing indicator while processing inference
  const triggerTyping = async () => {
    try {
      await message.channel.sendTyping();
    } catch (err) {
      // Non-fatal if channel permissions disallow typing indicators
    }
  };

  await triggerTyping();
  const typingTimer = setInterval(triggerTyping, 8000);

  try {
    // 1. Process multimodal image attachment (if present)
    const firstAttachment = message.attachments.first();
    const visualSummary = await inspectImageAttachment(firstAttachment);

    // 2. Assemble context payload
    let contextualUserPrompt = cleanUserText;
    if (visualSummary) {
      const visionTag = `[Eeper looks at the picture: ${visualSummary}]`;
      contextualUserPrompt = contextualUserPrompt
        ? `${contextualUserPrompt}\n\n${visionTag}`
        : visionTag;
    }

    // Default fallback if user sent an empty mention without text or images
    if (!contextualUserPrompt) {
      contextualUserPrompt = "*softly taps your paw*";
    }

    // 3. Load dynamic persona from Obsidian memory files
    const systemPrompt = await loadDynamicSystemPrompt(message.author.id);

    // 4. Retrieve sliding channel buffer
    const channelHistory = getChannelHistory(message.channelId);

    // 5. Construct conversation payload for OpenRouter
    const conversationPayload = [
      { role: "system", content: systemPrompt },
      ...channelHistory,
      { role: "user", content: contextualUserPrompt },
    ];

    console.log(`[Inference] Generating response for ${message.author.tag} (${message.author.id})...`);

    // 6. Generate companion reply via multi-model fallback cascade
    const replyContent = await generateEeperReply(conversationPayload);

    // 7. Update sliding in-memory buffer
    appendToChannelHistory(message.channelId, contextualUserPrompt, replyContent);

    // 8. Transmit response to Discord (splitting if exceeding 2000 chars)
    const messageParts = splitMessageContent(replyContent);
    for (let index = 0; index < messageParts.length; index++) {
      if (index === 0) {
        await message.reply({
          content: messageParts[index],
          allowedMentions: { repliedUser: true },
        });
      } else {
        await message.channel.send({ content: messageParts[index] });
      }
    }
  } catch (error) {
    console.error("[Bot Error] Runtime exception in message processing:", error);

    // Feline fallback response so the user receives friendly feedback
    try {
      await message.reply({
        content: "*yawns, tucks paws underneath, and blinks slowly...* (Eeper seems too sleepy to answer right now... *soft purr*)",
        allowedMentions: { repliedUser: false },
      });
    } catch (fallbackError) {
      console.error("[Bot Error] Failed to send fallback message:", fallbackError.message);
    }
  } finally {
    clearInterval(typingTimer);
  }
});

// ============================================================================
// 8. Process Lifecycle & Execution
// ============================================================================

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception:", error);
});

client.login(DISCORD_BOT_TOKEN);
