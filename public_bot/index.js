require('dotenv').config({ path: '../.env' });
const { Client, GatewayIntentBits, Events, SlashCommandBuilder } = require('discord.js');
const { startPeriodicAnnouncement } = require('./commands/announcements.js');
const fs = require('fs');
const path = require('path');

// Create a write stream for your log file (append mode)
const logStream = fs.createWriteStream(path.join(__dirname, 'bot.log'), { flags: 'a' });

// Helper to format timestamps
function timestamp() {
  return new Date().toISOString();
}

// Override console methods
['log', 'info', 'warn', 'error'].forEach(method => {
  const orig = console[method];
  console[method] = (...args) => {
    const msg = `[${timestamp()}] [${method.toUpperCase()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')}\n`;
    logStream.write(msg);
    orig.apply(console, args); // Still print to terminal
  };
});

// Require and create the db connection pool
const mysql = require('mysql2/promise');
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
};
let db;

// Create the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize DB and start bot
async function main() {
  db = await mysql.createPool(dbConfig);

  client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    // List all servers (guilds) the bot is connected to
    const guilds = client.guilds.cache.map(guild => `${guild.name} (${guild.id})`);
    console.log(`Connected to ${guilds.length} server(s):`);
    guilds.forEach(g => console.log(` - ${g}`));
    startPeriodicAnnouncement(client, db);
  });

  // Dynamically load subcommands and handlers
  const commandsPath = path.join(__dirname, 'commands');
  const commandGroups = { guildbot: [], 'admin-guildbot': [] };
  const commandHandlers = {};

  fs.readdirSync(commandsPath).forEach(file => {
    const command = require(path.join(commandsPath, file));
    for (const group of ['guildbot', 'admin-guildbot']) {
      if (command[group]) {
        commandGroups[group].push(...command[group]);
        command[group].forEach(sub => {
          commandHandlers[`${group}:${sub.name}`] = command.handle;
        });
      }
    }
  });

  // Build the top-level commands
  const guildbotCommand = new SlashCommandBuilder()
    .setName('guildbot')
    .setDescription('Guild bot commands');
  commandGroups.guildbot.forEach(sub => guildbotCommand.addSubcommand(sub));

  const adminGuildbotCommand = new SlashCommandBuilder()
    .setName('admin-guildbot')
    .setDescription('Admin-only guild bot commands');
  commandGroups['admin-guildbot'].forEach(sub => adminGuildbotCommand.addSubcommand(sub));

  // Register all commands
  client.on('ready', async () => {
    await client.application.commands.set([guildbotCommand.toJSON(), adminGuildbotCommand.toJSON()]);
  });

  // Handle interactions
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const sub = interaction.options.getSubcommand();
    const key = `${interaction.commandName}:${sub}`;
    if (commandHandlers[key]) {
      await commandHandlers[key](interaction, client, db);
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(err => {
  console.error('Failed to start bot:', err);
});