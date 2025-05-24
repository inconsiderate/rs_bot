const { ChannelType, SlashCommandBuilder, SlashCommandSubcommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { fetchAndUpsertStory, buildStoryListEmbed } = require('../utils/scraperUtils');
const { sanitizeUserId, checkAdminPermissions } = require('../utils/userUtils');

const configPath = path.join(__dirname, '../../config_stories.json');
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
      .setName('stories')
      .setDescription('Displays all stories saved to a specific user (yourself if no user is specified).')
      .addStringOption(opt =>
        opt.setName('discord-username')
          .setDescription('Discord user ID (e.g. 146365826939748353)')
          .setRequired(false)
      ),
  ],
  'admin-guildbot': [
    new SlashCommandSubcommandBuilder()
      .setName('user-story-add')
      .setDescription('Maps a user to a story, allowing multiple stories per user. Admin only.')
      .addStringOption(opt =>
        opt.setName('discord-username')
          .setDescription('Discord user')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('story-url')
          .setDescription('Story URL')
          .setRequired(true)
      ),
    new SlashCommandSubcommandBuilder()
      .setName('user-story-delete')
      .setDescription('Deletes all story mappings for a specific user. Admin only.')
      .addStringOption(opt =>
        opt.setName('discord-username')
          .setDescription('Discord user')
          .setRequired(true)
      ),
  ],
  handle: async (interaction, client, db) => {
    // Ensure users key exists
    if (!botConfig.users) botConfig.users = {};

    const guildId = interaction.guild.id;

    // /admin-guildbot user-story-add
    if (interaction.commandName === 'admin-guildbot' && interaction.options.getSubcommand() === 'user-story-add') {
      if (!await checkAdminPermissions(interaction)) return;
      let discordUserId = sanitizeUserId(
        interaction.options.getString('discord-username'),
        interaction.user.id
      );
      const storyUrl = interaction.options.getString('story-url');

      // --- Add this block to verify the user is in the guild ---
      let member;
      try {
        member = await interaction.guild.members.fetch(discordUserId);
      } catch {
        member = null;
      }
      if (!member) {
        await interaction.reply({ content: `User ID ${discordUserId} is not a member of this server.`, flags: 64 });
        return;
      }
      // --------------------------------------------------------

      try {
        const {
          storyId,
          storyName,
          trimmedBlurb,
          stats
        } = await fetchAndUpsertStory(storyUrl, db);

        // Save mapping to config (append, don't overwrite)
        if (!botConfig.users[guildId]) botConfig.users[guildId] = {};
        if (!botConfig.users[guildId][discordUserId]) botConfig.users[guildId][discordUserId] = [];
        if (!botConfig.users[guildId][discordUserId].includes(storyId)) {
          botConfig.users[guildId][discordUserId].push(storyId);
          saveConfig();

          // Fetch the new story row with all relevant fields for the embed
          const [storyRows] = await db.query(
            `SELECT s.story_name, s.story_address, s.blurb, s.cover_image
             FROM story s
             WHERE s.id = ?`,
            [storyId]
          );

          storyRows[0].blurb = trimmedBlurb;
          const statsObj = {
            followers: stats.followers ?? null,
            favourites: stats.favourites ?? null,
            ratings: stats.ratings ?? null,
            totalViews: stats.totalViews ?? null,
            wordCount: stats.wordCount ?? null
          };

          const embed = buildStoryListEmbed(storyRows[0], statsObj);
          await interaction.reply({
            content: `New story mapped to <@${discordUserId}> in this server:`,
            embeds: [embed],
            flags: 64
          });
        } else {
          await interaction.reply({ content: `<@${discordUserId}> is already mapped to **${storyName}** in this server.`, flags: 64 });
        }
      } catch (err) {
        await interaction.reply({ content: `Failed to fetch or parse story: ${err.message}`, flags: 64 });
        return;
      }

      return;
    }

    // /admin-guildbot user-story-delete
    if (interaction.commandName === 'admin-guildbot' && interaction.options.getSubcommand() === 'user-story-delete') {
      if (!await checkAdminPermissions(interaction)) return;
      let discordUserId = sanitizeUserId(
        interaction.options.getString('discord-username'),
        interaction.user.id
      );
      if (botConfig.users[guildId]?.[discordUserId]) {
        delete botConfig.users[guildId][discordUserId];
        saveConfig();
        await interaction.reply({ content: `Deleted all story mappings for <@${discordUserId}> in this server.`, flags: 64 });
      } else {
        await interaction.reply({ content: `No story mappings found for <@${discordUserId}> in this server.`, flags: 64 });
      }
      return;
    }

    // /guildbot stories
    if (interaction.commandName === 'guildbot' && interaction.options.getSubcommand() === 'stories') {
      let discordUserId = sanitizeUserId(
        interaction.options.getString('discord-username'),
        interaction.user.id
      );
      let storyIds = botConfig.users?.[guildId]?.[discordUserId];
      // Remove duplicates
      storyIds = [...new Set(storyIds)];

      if (!storyIds || !Array.isArray(storyIds) || storyIds.length === 0) {
        await interaction.reply({ content: `No story mappings found for <@${discordUserId}> in this server.`, flags: 64 });
        return;
      }

      // Lookup all story names and rsmatch info from the DB
      const [rows] = await db.query(
        `
        SELECT 
          s.story_name, 
          s.story_address, 
          s.latest_followers, 
          s.latest_views, 
          s.cover_image
        FROM story s
        WHERE s.id IN (${storyIds.map(() => '?').join(',')})
        `,
        storyIds
      );
      if (rows.length === 0) {
        await interaction.reply({ content: `No stories found in the database for <@${discordUserId}> in this server.`, flags: 64 });
        return;
      }

      const embeds = [];
      for (const row of rows) {
        // Use only DB values, do not scrape live
        const statsObj = {
          followers: row.latest_followers ?? null,
          totalViews: row.latest_views ?? null,
        };

        // Always trim the blurb for display and always add "..." if trimmed
        let blurb = row.blurb || '';
        let trimmedBlurb = blurb;
        if (blurb.length) {
          trimmedBlurb = blurb.slice(0, 130).replace(/\s+?(\S+)?$/, '') + '...';
        }
        row.blurb = trimmedBlurb;

        embeds.push(buildStoryListEmbed(row, statsObj));
      }

      const userObj = await client.users.fetch(discordUserId).catch(() => null);
      const displayName = userObj?.globalName || userObj?.displayName || userObj?.username || discordUserId;

      await interaction.reply({
        content: `Stories mapped to ${displayName} in this server:`,
        embeds,
        // No flags for public message
      });
      return;
    }
  }
};