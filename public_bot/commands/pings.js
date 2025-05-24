const { ChannelType, SlashCommandSubcommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { sanitizeUserId, checkAdminPermissions } = require('../utils/userUtils');

const configPath = path.join(__dirname, '../../config_pings.json');
let botConfig = {};
if (fs.existsSync(configPath)) {
  botConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2));
}

module.exports = {
  guildbot: [
    new SlashCommandSubcommandBuilder()
      .setName('helpers')
      .setDescription('Ask someone for help!')
  ],
  'admin-guildbot': [
    new SlashCommandSubcommandBuilder()
      .setName('ping-add')
      .setDescription('Set forum channel, notification channel, and role for helper notifications. Admin only.')
      .addChannelOption(opt =>
        opt.setName('forum-channel').setDescription('Forum channel').addChannelTypes(ChannelType.GuildForum).setRequired(true)
      )
      .addChannelOption(opt =>
        opt.setName('notification-channel').setDescription('Notification channel').addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Role to ping').setRequired(true)
      ),
    new SlashCommandSubcommandBuilder()
      .setName('ping-delete')
      .setDescription('Removes the notification/role mapping for a specific forum channel. Admin only.')
      .addChannelOption(opt =>
        opt.setName('forum-channel').setDescription('Forum channel to remove').addChannelTypes(ChannelType.GuildForum).setRequired(true)
      ),
  ],
  handle: async (interaction, client) => {
    // /admin-guildbot ping-add
    if (interaction.commandName === 'admin-guildbot' && interaction.options.getSubcommand() === 'ping-add') {
      if (!await checkAdminPermissions(interaction)) return;
      const forum = interaction.options.getChannel('forum-channel');
      const role = interaction.options.getRole('role');
      const alert = interaction.options.getChannel('notification-channel');
      botConfig[interaction.guild.id] = botConfig[interaction.guild.id] || {};
      botConfig[interaction.guild.id][forum.id] = {
        roleId: role.id,
        alertChannelId: alert.id,
      };
      saveConfig();
      await interaction.reply({ content: `Configured: In <#${forum.id}>, /guildbot helpers will ping <@&${role.id}> in <#${alert.id}>.`, flags: 64 });
      return;
    }

    // /admin-guildbot ping-delete
    if (interaction.commandName === 'admin-guildbot' && interaction.options.getSubcommand() === 'ping-delete') {
      if (!await checkAdminPermissions(interaction)) return;
      const forum = interaction.options.getChannel('forum-channel');
      if (
        botConfig[interaction.guild.id] &&
        botConfig[interaction.guild.id][forum.id]
      ) {
        delete botConfig[interaction.guild.id][forum.id];
        saveConfig();
        await interaction.reply({ content: `Mapping for <#${forum.id}> deleted.`, flags: 64 });
      } else {
        await interaction.reply({ content: `No mapping found for <#${forum.id}>.`, flags: 64 });
      }
      return;
    }

    // /guildbot helpers
    if (interaction.commandName === 'guildbot' && interaction.options.getSubcommand() === 'helpers') {
      const guildConfig = botConfig[interaction.guild.id] || {};
      const forumConfig = guildConfig[interaction.channel.parentId];
      if (
        !forumConfig ||
        interaction.channel.parentId == null ||
        (interaction.channel.type !== ChannelType.PublicThread && interaction.channel.type !== ChannelType.PrivateThread)
      ) {
        await interaction.reply({ content: 'This command can only be used in a configured forum thread.', flags: 64 });
        return;
      }

      const { roleId, alertChannelId } = forumConfig;
      const alertChannel = await client.channels.fetch(alertChannelId);
      if (!alertChannel) {
        await interaction.reply({ content: 'Notification channel not found.', flags: 64 });
        return;
      }

      // Sanitize user ID for mention (not strictly necessary here, but for consistency)
      const userId = sanitizeUserId(interaction.user.id);

      const threadLink = `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
      const notificationMessage = await alertChannel.send(
        `<@${userId}> has requested the attention of all <@&${roleId}> in: [${interaction.channel.name}](${threadLink})`
      );
      const notificationLink = `https://discord.com/channels/${interaction.guild.id}/${alertChannel.id}/${notificationMessage.id}`;
      await interaction.reply({ content: `People have been notified! [Jump to message.](${notificationLink})` });
    }
  }
};