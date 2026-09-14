import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  WebhookClient,
} from "discord.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import matter from "gray-matter";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 1. Environment Verification & Validation
// ============================================================================

const {
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  DEBATE_WEBHOOK_URL,
  OPENROUTER_API_KEY,
  VAULT_DIR = __dirname,
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

if (!DISCORD_BOT_TOKEN) {
  console.error("CRITICAL: DISCORD_BOT_TOKEN is missing from environment.");
  process.exit(1);
}

if (!DISCORD_CLIENT_ID) {
  console.error("CRITICAL: DISCORD_CLIENT_ID is missing from environment.");
  process.exit(1);
}

if (!DEBATE_WEBHOOK_URL) {
  console.error("CRITICAL: DEBATE_WEBHOOK_URL is missing from environment.");
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.error("CRITICAL: OPENROUTER_API_KEY is missing from environment.");
  process.exit(1);
}

// Initialize OpenRouter Client
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  timeout: 30000,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/frtzhahn/mocha-automata",
    "X-Title": "Disceptatio Dialectical Arena",
  },
});

// Initialize Discord Webhook Client for dynamic speaker avatars & names
const webhookClient = new WebhookClient({ url: DEBATE_WEBHOOK_URL });

// Initialize Discord Gateway Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Gateway connection error handling
client.on("error", (err) => console.error("[Gateway Error]:", err));
client.on("shardError", (err, shardId) => console.error(`[Shard ${shardId} Error]:`, err));

// Helper for natural pauses between speech turns
const waitDelay = (ms = 3000) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// 2. Persona Loader & Vault Management
// ============================================================================

/**
 * Loads a persona Markdown file, parsing YAML frontmatter and instructional body.
 * @param {string} slug - Persona filename slug (e.g. 'marcus', 'nietzsche')
 */
async function loadPersona(slug) {
  const safeSlug = path.basename(slug, ".md");
  const resolvedVault = path.resolve(VAULT_DIR);
  const personaPath = path.join(resolvedVault, "personas", `${safeSlug}.md`);

  try {
    const raw = await fs.readFile(personaPath, "utf-8");
    const { data, content } = matter(raw);

    if (!data.name) {
      throw new Error(`Persona at ${slug}.md is missing a 'name' frontmatter field.`);
    }

    return {
      slug,
      name: data.name,
      avatar_url:
        data.avatar_url ||
        "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
      voice_tone: data.voice_tone || "Rigorous, philosophical, concise",
      instructions: content.trim(),
    };
  } catch (err) {
    throw new Error(`Unable to load persona '${slug}' at ${personaPath}: ${err.message}`);
  }
}

/**
 * Slugifies a string for filesystem safe naming.
 */
function slugifyTopic(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45);
}

// ============================================================================
// 3. LLM Speech Generation & Webhook Dispatch
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
 * Dispatches an LLM request to OpenRouter tailored to the specific dialectical stage.
 */
async function generateSpeech({
  speaker,
  opponent,
  topic,
  roundNumber,
  roundTitle,
  roundDirective,
  priorTurns,
}) {
  const systemPrompt = [
    `You are ${speaker.name}.`,
    speaker.instructions,
    `Voice & Delivery Tone: ${speaker.voice_tone}.`,
    `You are participating in a structured dialectical arena debate against ${opponent.name}.`,
    `Motion / Topic: "${topic}".`,
    `Current Stage: Round ${roundNumber} (${roundTitle}).`,
    `DIRECTIVE:`,
    `- ${roundDirective}`,
    `- Keep your answer strictly under 150 words. Be intellectually profound, sharp, and uncompromising.`,
    `- CRITICAL: You must speak directly in the first person.`,
    `- CRITICAL: Do NOT draft, plan, outline, or explain your thinking process. Begin your output immediately with the very first spoken word of your dialogue.`,
    `- DO NOT output preambles, meta-commentary, stage directions, or intros (e.g., never say 'Here is my argument' or 'As [Name]').`,
    `- DO NOT output internal monologues or thought processes. Output ONLY your raw spoken words in the debate.`,
  ].join("\n\n");

  const conversation = [
    { role: "system", content: systemPrompt },
    ...priorTurns.map((turn) => ({
      role: turn.speakerSlug === speaker.slug ? "assistant" : "user",
      content: `${turn.speakerName}: ${turn.content}`,
    })),
    {
      role: "user",
      content: `Deliver your Round ${roundNumber} (${roundTitle}) speech on: "${topic}".`,
    },
  ];

  const maxRetries = 2;
  const debater = speaker;

  // 3. Provider Chaining: Loop sequentially through dynamic liveFreeModels
  for (const model of liveFreeModels) {
    let modelFailed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model,
          messages: conversation,
          temperature: 0.7,
          max_tokens: 1500,
        });

        const rawReply = completion?.choices?.[0]?.message?.content;
        const cleanReply = sanitizeSpeech(rawReply);
        if (cleanReply) {
          return cleanReply;
        }

        // Empty completion returned from model
        console.warn(
          `[Cascade Failover] Model ${model} failed (empty completion content). Trying next fallback model...`
        );
        modelFailed = true;
        break;
      } catch (err) {
        const status = err.status || err.statusCode || err.response?.status;

        // 400 (invalid ID) or 404 (model deprecated/unavailable): fail over immediately
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
          `[Inference Error] Model ${model} attempt ${attempt + 1}/${maxRetries + 1} failed for ${debater.name}: ${err.message}`
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

  // Fatal cascade failure if every single model in liveFreeModels fails
  throw new Error("All free tier models in the fallback cascade are temporarily unavailable.");
}

/**
 * Dispatches a speech payload to Discord using the webhook client.
 */
async function dispatchWebhookSpeech(speaker, speechText) {
  // Safeguard Discord 2000-character boundary
  const safeContent = speechText.length > 1950 ? speechText.slice(0, 1950) + "..." : speechText;

  await webhookClient.send({
    username: speaker.name,
    avatarURL: speaker.avatar_url,
    content: safeContent,
  });
}

// ============================================================================
// 4. Obsidian Transcript Archival
// ============================================================================

/**
 * Compiles and writes the complete debate transcript as a formatted Obsidian note.
 */
async function archiveDebateToVault({ topic, debaterA, debaterB, transcript }) {
  const resolvedVault = path.resolve(VAULT_DIR);
  const transcriptsDir = path.join(resolvedVault, "transcripts");
  await fs.mkdir(transcriptsDir, { recursive: true });

  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];
  const slugified = slugifyTopic(topic);
  const fileName = `${dateStr}-${slugified}.md`;
  const filePath = path.join(transcriptsDir, fileName);

  const frontmatter = [
    "---",
    `date: "${dateStr}"`,
    `timestamp: "${today.toISOString()}"`,
    `topic: "${topic.replace(/"/g, '\\"')}"`,
    "participants:",
    `  - name: "${debaterA.name}"`,
    `    slug: "${debaterA.slug}"`,
    `  - name: "${debaterB.name}"`,
    `    slug: "${debaterB.slug}"`,
    `model: "${LLM_MODEL}"`,
    "status: completed",
    "tags:",
    "  - dialectic",
    "  - philosophy",
    "  - debate",
    "---",
  ].join("\n");

  const bodySections = [];
  bodySections.push(`# Disceptatio Arena: ${topic}\n`);
  bodySections.push(`**Date:** ${dateStr}  `);
  bodySections.push(`**Motion:** *"${topic}"*  `);
  bodySections.push(`**Debaters:** [[${debaterA.slug}|${debaterA.name}]] vs. [[${debaterB.slug}|${debaterB.name}]]\n`);
  bodySections.push(`---\n`);

  const rounds = [
    { num: 1, title: "Thesis (Opening Statements)" },
    { num: 2, title: "Antithesis (Rebuttal & Refutation)" },
    { num: 3, title: "Synthesis (Closing Maxims)" },
  ];

  for (const r of rounds) {
    bodySections.push(`## Round ${r.num}: ${r.title}\n`);
    const roundTurns = transcript.filter((t) => t.roundNumber === r.num);
    for (const turn of roundTurns) {
      bodySections.push(`### ${turn.speakerName}\n`);
      bodySections.push(`> ${turn.content.replace(/\n/g, "\n> ")}\n`);
    }
    bodySections.push(`---\n`);
  }

  const finalMarkdown = `${frontmatter}\n\n${bodySections.join("\n")}`;
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, finalMarkdown, "utf-8");
  await fs.rename(tmpPath, filePath);

  return { fileName, filePath };
}

// ============================================================================
// 5. Slash Command Registration & Deployment
// ============================================================================

const debateCommand = new SlashCommandBuilder()
  .setName("debate")
  .setDescription("Initiate a 3-round dialectical philosophical debate between two personas.")
  .addStringOption((opt) =>
    opt
      .setName("topic")
      .setDescription("The motion or philosophical question to debate")
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("debater_a")
      .setDescription("Slug of the first persona")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("debater_b")
      .setDescription("Slug of the second persona")
      .setRequired(true)
      .setAutocomplete(true)
  );

async function deploySlashCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);
  try {
    console.log("[Director] Deploying application (slash) commands to Discord API...");
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: [debateCommand.toJSON()],
    });
    console.log("[Director] Successfully registered global /debate slash command.");
  } catch (err) {
    console.error("[Director] Failed to register slash commands:", err);
  }
}

// ============================================================================
// 6. Interaction Handlers: Autocomplete & Command Execution
// ============================================================================

client.once("clientReady", async () => {
  console.log("==================================================");
  console.log(`[Disceptatio] Director online! Logged in as ${client.user.tag}`);
  console.log(`[Vault] Directory: ${path.resolve(VAULT_DIR)}`);
  console.log(`[Model] Primary: ${cleanModel}`);

  // Dynamic runtime model discovery via OpenRouter API
  await updateLiveFreeModels();

  console.log(
    `[Model Cascade] Pool (${liveFreeModels.length} models): ${liveFreeModels.slice(0, 5).join(" -> ")}...`
  );
  console.log("==================================================");

  // Automatically deploy application commands on ready
  await deploySlashCommands();
});

client.on("interactionCreate", async (interaction) => {
  // Autocomplete Handler
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === "debate") {
      const focused = interaction.options.getFocused(true);

      if (focused.name === "debater_a" || focused.name === "debater_b") {
        try {
          const personasDir = path.join(path.resolve(VAULT_DIR), "personas");
          const dirFiles = await fs.readdir(personasDir);
          const mdFiles = dirFiles.filter((f) => f.endsWith(".md"));

          const choices = [];
          for (const file of mdFiles) {
            const slug = file.replace(/\.md$/, "");
            try {
              const raw = await fs.readFile(path.join(personasDir, file), "utf-8");
              const { data } = matter(raw);
              const label = data.name ? `${data.name} (${slug})` : slug;
              choices.push({ name: label, value: slug });
            } catch {
              choices.push({ name: slug, value: slug });
            }
          }

          const query = focused.value.toLowerCase().trim();
          const filtered = choices
            .filter(
              (c) =>
                c.name.toLowerCase().includes(query) ||
                c.value.toLowerCase().includes(query)
            )
            .slice(0, 25);

          await interaction.respond(filtered);
        } catch (err) {
          console.error("[Autocomplete Error]", err);
          await interaction.respond([]);
        }
      }
    }
    return;
  }

  // Slash Command Handler
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "debate") {
      await interaction.deferReply();

      const topic = interaction.options.getString("topic", true);
      const slugA = path.basename(interaction.options.getString("debater_a", true), ".md");
      const slugB = path.basename(interaction.options.getString("debater_b", true), ".md");

      let debaterA, debaterB;

      try {
        debaterA = await loadPersona(slugA);
        debaterB = await loadPersona(slugB);
      } catch (err) {
        await interaction.editReply({
          content: `⚠️ **Director Error:** Failed to load personas. ${err.message}`,
        });
        return;
      }

      // Director Intro Embed
      const introEmbed = new EmbedBuilder()
        .setTitle("🏛️ Disceptatio: Dialectical Arena")
        .setDescription(
          `**The Chamber is Called to Order.**\n\n` +
          `**Motion:** *"${topic}"*\n\n` +
          `**Participants:**\n` +
          `🔹 **${debaterA.name}** (*${debaterA.voice_tone}*)\n` +
          `🔸 **${debaterB.name}** (*${debaterB.voice_tone}*)\n\n` +
          `*Structure: 3 Rounds (Thesis, Antithesis, Synthesis). Deliberation commences now.*`
        )
        .setColor(0x8b0000)
        .setThumbnail("https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Socrates_Piazza_dei_Cavalieri_Pisa.jpg/440px-Socrates_Piazza_dei_Cavalieri_Pisa.jpg")
        .setFooter({ text: `Engine: ${LLM_MODEL} | Webhook Protocol Active` })
        .setTimestamp();

      await interaction.editReply({ embeds: [introEmbed] });

      const transcript = [];

      try {
        // Round 1: Thesis
        console.log(`[Chamber] Round 1: Thesis initiated.`);
        await waitDelay(3000);
        const speechA1 = await generateSpeech({
          speaker: debaterA,
          opponent: debaterB,
          topic,
          roundNumber: 1,
          roundTitle: "Thesis",
          roundDirective: "Deliver your independent opening thesis statement defending your philosophical stance on the motion (max 150 words).",
          priorTurns: transcript,
        });
        await dispatchWebhookSpeech(debaterA, speechA1);
        transcript.push({ roundNumber: 1, speakerName: debaterA.name, speakerSlug: debaterA.slug, content: speechA1 });

        await waitDelay(3000);
        const speechB1 = await generateSpeech({
          speaker: debaterB,
          opponent: debaterA,
          topic,
          roundNumber: 1,
          roundTitle: "Thesis",
          roundDirective: "Deliver your independent opening thesis statement defending your philosophical stance on the motion (max 150 words).",
          priorTurns: transcript,
        });
        await dispatchWebhookSpeech(debaterB, speechB1);
        transcript.push({ roundNumber: 1, speakerName: debaterB.name, speakerSlug: debaterB.slug, content: speechB1 });

        // Round 2: Antithesis
        console.log(`[Chamber] Round 2: Antithesis initiated.`);
        await waitDelay(3000);
        const speechA2 = await generateSpeech({
          speaker: debaterA,
          opponent: debaterB,
          topic,
          roundNumber: 2,
          roundTitle: "Antithesis",
          roundDirective: `Directly rebut and dismantle ${debaterB.name}'s Round 1 thesis using your philosophical framework (max 150 words).`,
          priorTurns: transcript,
        });
        await dispatchWebhookSpeech(debaterA, speechA2);
        transcript.push({ roundNumber: 2, speakerName: debaterA.name, speakerSlug: debaterA.slug, content: speechA2 });

        await waitDelay(3000);
        const speechB2 = await generateSpeech({
          speaker: debaterB,
          opponent: debaterA,
          topic,
          roundNumber: 2,
          roundTitle: "Antithesis",
          roundDirective: `Directly rebut and dismantle ${debaterA.name}'s arguments using your philosophical framework (max 150 words).`,
          priorTurns: transcript,
        });
        await dispatchWebhookSpeech(debaterB, speechB2);
        transcript.push({ roundNumber: 2, speakerName: debaterB.name, speakerSlug: debaterB.slug, content: speechB2 });

        // Round 3: Synthesis
        console.log(`[Chamber] Round 3: Synthesis initiated.`);
        await waitDelay(3000);
        const speechA3 = await generateSpeech({
          speaker: debaterA,
          opponent: debaterB,
          topic,
          roundNumber: 3,
          roundTitle: "Synthesis",
          roundDirective: `Deliver your final closing maxim. Defend your core view while explicitly naming one valid insight made by ${debaterB.name} (max 150 words).`,
          priorTurns: transcript,
        });
        await dispatchWebhookSpeech(debaterA, speechA3);
        transcript.push({ roundNumber: 3, speakerName: debaterA.name, speakerSlug: debaterA.slug, content: speechA3 });

        await waitDelay(3000);
        const speechB3 = await generateSpeech({
          speaker: debaterB,
          opponent: debaterA,
          topic,
          roundNumber: 3,
          roundTitle: "Synthesis",
          roundDirective: `Deliver your final closing maxim. Defend your core view while explicitly naming one valid insight made by ${debaterA.name} (max 150 words).`,
          priorTurns: transcript,
        });
        await dispatchWebhookSpeech(debaterB, speechB3);
        transcript.push({ roundNumber: 3, speakerName: debaterB.name, speakerSlug: debaterB.slug, content: speechB3 });

        // Archive to Obsidian Vault
        console.log(`[Chamber] Archiving debate transcript to Obsidian vault...`);
        const { fileName, filePath } = await archiveDebateToVault({
          topic,
          debaterA,
          debaterB,
          transcript,
        });

        // Director Final Embed
        const conclusionEmbed = new EmbedBuilder()
          .setTitle("🏛️ Disceptatio: Motion Concluded")
          .setDescription(
            `**The 3-Round Dialectic is complete.**\n\n` +
            `**Topic:** *"${topic}"*\n` +
            `**Disputants:** ${debaterA.name} & ${debaterB.name}\n\n` +
            `📁 **Saved to Vault:** \`${fileName}\``
          )
          .setColor(0x2e8b57)
          .setFooter({ text: "Deliberation archived to vault." })
          .setTimestamp();

        await interaction.followUp({ embeds: [conclusionEmbed] });
        console.log(`[Chamber] Debate on "${topic}" successfully concluded and archived.`);
      } catch (debateError) {
        console.error("[Chamber Error] Debate execution interrupted:", debateError);

        const suspensionEmbed = new EmbedBuilder()
          .setTitle("🏛️ Arena Suspended")
          .setDescription(
            "The debate was halted due to upstream free inference capacity issues. Please try again shortly."
          )
          .setColor(0xff4444)
          .setTimestamp();

        try {
          await interaction.followUp({ embeds: [suspensionEmbed] });
        } catch (followUpErr) {
          console.error("[Chamber Error] Failed to send suspension embed:", followUpErr.message);
        }
        return;
      }
    }
  }
});

// Process Error Guardrails
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception:", error);
});

// Login Bot to Gateway
client.login(DISCORD_BOT_TOKEN);
