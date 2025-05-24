const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, '../../config_base.json');
let botConfig = {};
if (fs.existsSync(configPath)) {
  botConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function sanitizeUserId(input, fallbackId) {
  if (!input) return fallbackId;
  return input.replace(/[<@!>]/g, '');
}

// Check admin permissions using commandRoleId from config
async function checkAdminPermissions(interaction) {
  const guildId = interaction.guildId || interaction.guild?.id;
  const commandRoleId = botConfig.guilds?.[guildId]?.commandRoleId;
  if (!commandRoleId || !interaction.member?.roles?.cache?.has(commandRoleId)) {
    await interaction.reply({ content: 'You need to be server staff to use this command.', flags: 64 });
    return false;
  }
  return true;
}

module.exports = { sanitizeUserId, checkAdminPermissions };