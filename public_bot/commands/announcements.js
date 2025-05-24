const { SlashCommandSubcommandBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { fetchAndUpsertStory, buildFullDataEmbed } = require('../utils/scraperUtils');
const { sanitizeUserId, checkAdminPermissions } = require('../utils/userUtils');
const { checkThresholds, THRESHOLDS, getGuildIds } = require('../utils/thresholds');

const configPath = path.join(__dirname, '../../config_base.json');
const storiesPath = path.join(__dirname, '../../config_stories.json');
const starsScanInterval = 15 * 60 * 1000; // 15 min
const liveStatsScanInterval = 60 * 60 * 1000; // 1hr
let botConfig = {};
let storyConfig = {};
if (fs.existsSync(configPath)) {
  botConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
if (fs.existsSync(storiesPath)) {
  storyConfig = JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
}
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2));
}
function saveStories() {
  fs.writeFileSync(storiesPath, JSON.stringify(storyConfig, null, 2));
}

/**
 * Periodically checks for stories newly on the Main Rising Stars list and posts an announcement.
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {import('mysql2/promise').Connection} db - The database connection.
 */
// Helper to reload configs
async function reloadConfigs() {
  if (fs.existsSync(configPath)) {
    botConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  if (fs.existsSync(storiesPath)) {
    storyConfig = JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
  }
}

// Helper to get user display name
async function getUserName(client, userId) {
  try {
    const userObj = await client.users.fetch(userId);
    return userObj.globalName || userObj.displayName || userObj.username || userId;
  } catch {
    return userId;
  }
}

// Live stats (thresholds) announcement, every 1 hour
async function postLiveStatsAnnouncements(client, db) {
  await reloadConfigs();

  for (const guildId in botConfig) {
    const channelId = botConfig[guildId]?.announcementChannel;
    if (!channelId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) continue;

      const usersInGuild = (storyConfig.users && storyConfig.users[guildId]) || {};
      for (const [userIdRaw, storyIdArray] of Object.entries(usersInGuild)) {
        const userId = sanitizeUserId(userIdRaw);
        for (const storyId of storyIdArray) {
          const [storyRows] = await db.query(
            `SELECT s.story_name, s.story_address, s.blurb, s.cover_image FROM story s WHERE s.id = ?`,
            [storyId]
          );
          const row = storyRows[0];
          if (!row) continue;

          // Use the utility to fetch, scrape, upsert, and get stats/tags
          const { stats, tags } = await fetchAndUpsertStory(row.story_address, db);

          // If the story is on Rising Stars, get its position for threshold checks
          const [rsRows] = await db.query(
            'SELECT * FROM rsmatch WHERE active > 0 AND story_id_id = ?',
            [storyId]
          );

          const genreList = ['adventure', 'action', 'comedy', 'fantasy', 'historical', 'horror', 'mystery', 'psychological', 'romance', 'satire', 'sci_fi', 'one_shot', 'tragedy'];
          let rsMain = false;
          let rsGenre = false;
          let rsTop10 = false;
          let rsPosition = null;
          let rsGenreList = [];

          for (const row of rsRows) {
            if (row.genre === 'main') {
              rsMain = true;
              rsPosition = Number(row.highest_position);
              if (rsPosition && rsPosition <= 10) {
                rsTop10 = true;
              }
            }
            // Only include genres you want to count for B-Rank
            if (genreList.includes(row.genre)) {
              rsGenre = true;
              rsGenreList.push({
                genre: row.genre,
                position: row.highest_position ? Number(row.highest_position) : undefined
              });
            }
          }

          const statsWithPosition = {
            ...stats,
            rsMain,
            rsGenre,
            rsTop10,
            rsPosition,
            rsGenreList
          };

          // Threshold check (always runs, uses scraped stats + RS position)
          storyConfig.announcedThresholds = storyConfig.announcedThresholds || {};
          storyConfig.announcedThresholds[guildId] = storyConfig.announcedThresholds[guildId] || {};
          storyConfig.announcedThresholds[guildId][storyId] = storyConfig.announcedThresholds[guildId][storyId] || {};

          // Collect all crossed and unannounced thresholds
          const crossed = [];
          for (const t of THRESHOLDS) {
            const key = t.key;
            const current = Number(statsWithPosition[t.statKey] || 0);
            if (
              !storyConfig.announcedThresholds[guildId][storyId][key] &&
              (
                (t.statKey === 'rsPosition')
                  ? (current > 0 && current <= t.value)
                  : (current >= t.value)
              )
            ) {
              crossed.push({ ...t, key });
            }
          }

          // Fetch the user object for display name (before sending messages)
          let userName = await getUserName(client, userId);

          // Group crossed by statKey and send the highest for each stat type
          const crossedByStat = {};
          for (const t of crossed) {
            if (
              !crossedByStat[t.statKey] ||
              (t.statKey === 'rsPosition'
                ? t.value < crossedByStat[t.statKey].value
                : t.value > crossedByStat[t.statKey].value)
            ) {
              crossedByStat[t.statKey] = t;
            }
          }

          for (const t of Object.values(crossedByStat)) {
            await channel.send({ content: t.message(userId, row.story_name, t.value, userName) });
            // Mark all thresholds at or below the highest as announced for this statKey
            for (const t2 of crossed) {
              if (
                t2.statKey === t.statKey &&
                (
                  (t2.statKey === 'rsPosition' && t2.value >= t.value) ||
                  (t2.statKey !== 'rsPosition' && t2.value <= t.value)
                )
              ) {
                storyConfig.announcedThresholds[guildId][storyId][t2.key] = true;
              }
            }
            saveStories(); // <-- Move this inside the loop, after updating the config
          }

          const guild = client.guilds.cache.get(guildId);
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            await handleRewardThresholds(client, guild, member, statsWithPosition, userName, row.story_name, storyId, guildId);
          }
        }
      }
    } catch (err) {
      console.error(`Failed to send live stats announcement to guild ${guildId}:`, err);
    }
  }
}

// Rising Stars DB check, every 15 minutes
async function postRisingStarsAnnouncements(client, db) {
  await reloadConfigs();

  for (const guildId in botConfig) {
    const channelId = botConfig[guildId]?.announcementChannel;
    if (!channelId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) continue;

      storyConfig.announcedMain = storyConfig.announcedMain || {};
      storyConfig.announcedMain[guildId] = storyConfig.announcedMain[guildId] || {};

      const usersInGuild = (storyConfig.users && storyConfig.users[guildId]) || {};
      for (const [userIdRaw, storyIdArray] of Object.entries(usersInGuild)) {
        const userId = sanitizeUserId(userIdRaw);
        for (const storyId of storyIdArray) {
          const [storyRows] = await db.query(
            `SELECT s.story_name, s.story_address, s.blurb FROM story s WHERE s.id = ?`,
            [storyId]
          );
          const row = storyRows[0];
          if (!row) continue;

          // Fetch stats and tags
          const { stats, tags } = await fetchAndUpsertStory(row.story_address, db);

          // Query all rsmatch rows for this story
          const [rsRows] = await db.query(
            'SELECT * FROM rsmatch WHERE active > 0 AND story_id_id = ?',
            [storyId]
          );

          // Build RS info
          const genreList = ['adventure', 'action', 'comedy', 'fantasy', 'historical', 'horror', 'mystery', 'psychological', 'romance', 'satire', 'sci_fi', 'one_shot', 'tragedy'];
          let rsMain = false;
          let rsGenre = false;
          let rsTop10 = false;
          let rsPosition = null;
          let rsGenreList = [];

          for (const rsRow of rsRows) {
            if (rsRow.genre === 'main') {
              rsMain = true;
              rsPosition = Number(rsRow.highest_position);
              if (rsPosition && rsPosition <= 10) {
                rsTop10 = true;
              }
            }
            if (genreList.includes(rsRow.genre)) {
              rsGenre = true;
              rsGenreList.push({
                genre: rsRow.genre,
                position: rsRow.highest_position ? Number(rsRow.highest_position) : undefined
              });
            }
          }

          const statsWithPosition = {
            ...stats,
            rsMain,
            rsGenre,
            rsTop10,
            rsPosition,
            rsGenreList
          };

          // Only announce if on Main and not already announced
          if (rsMain && !storyConfig.announcedMain[guildId][storyId]) {
            const userName = await getUserName(client, userId);
            const messageText = `**<@${userId}>'s story ${row.story_name} has reached Rising Stars Main at position #${rsPosition ?? 'unknown'}! 🎉**`;
            const embed = buildFullDataEmbed(row, statsWithPosition, tags);
            await channel.send({ content: messageText, embeds: [embed] });
            storyConfig.announcedMain[guildId][storyId] = true;
            saveStories();
          }
        }
      }
    } catch (err) {
      console.error(`Failed to send Rising Stars announcement to guild ${guildId}:`, err);
    }
  }
}

// Reward thresholds handling
async function handleRewardThresholds(client, guild, member, stats, userName, storyName, storyId, guildId) {
  const rewardThresholds = THRESHOLDS.filter(t => t.statKey === 'rewardThreshold');
  // Find the highest rank the user qualifies for
  let achievedRank = null;
  let achievedThreshold = null;
  for (const t of rewardThresholds) {
    if (t.check(stats)) {
      achievedRank = t.rewardRank;
      achievedThreshold = t;
    }
  }
  if (!achievedRank) return;

  // Save per-user per-story rank in config for idempotency
  storyConfig.userRanks = storyConfig.userRanks || {};
  storyConfig.userRanks[guildId] = storyConfig.userRanks[guildId] || {};
  storyConfig.userRanks[guildId][member.id] = storyConfig.userRanks[guildId][member.id] || {};
  const prevRank = storyConfig.userRanks[guildId][member.id][storyId];

  if (prevRank === achievedRank) return; // Already has this rank

  // Get role and channel IDs from config
  const guildIds = getGuildIds(guildId);

  // Remove previous grade rank role if present
  const gradeRoleIds = [guildIds.bRankRoleId, guildIds.aRankRoleId, guildIds.sRankRoleId];
  for (const roleId of gradeRoleIds) {
    if (roleId && member.roles.cache.has(roleId) && roleId !== achievedThreshold.getRoleId(guildId)) {
      await member.roles.remove(roleId).catch(() => {});
    }
  }

  // Add "Ranks" role and the new grade rank role
  if (guildIds.ranksRoleId && !member.roles.cache.has(guildIds.ranksRoleId)) {
    await member.roles.add(guildIds.ranksRoleId).catch(() => {});
  }
  const gradeRoleId = achievedThreshold.getRoleId(guildId);
  if (gradeRoleId && !member.roles.cache.has(gradeRoleId)) {
    await member.roles.add(gradeRoleId).catch(() => {});
  }

  // Save the new rank
  storyConfig.userRanks[guildId][member.id][storyId] = achievedRank;
  saveStories();

  // Send congrats message in the "Ranks" channel
  if (guildIds.ranksChannelId) {
    const ranksChannel = guild.channels.cache.get(guildIds.ranksChannelId);
    if (ranksChannel && ranksChannel.isTextBased()) {
      try {
        await ranksChannel.send({
          content: achievedThreshold.message(userName, storyName, null, stats, member.id)
        });
      } catch (err) {
        console.error('Failed to send congrats message in Ranks channel:', err);
      }
    }
  }
}

// Main entry point
function startPeriodicAnnouncement(client, db) {
  postLiveStatsAnnouncements(client, db);
  postRisingStarsAnnouncements(client, db);
  setInterval(() => postLiveStatsAnnouncements(client, db), liveStatsScanInterval); 
  setInterval(() => postRisingStarsAnnouncements(client, db), starsScanInterval);
}

module.exports = {
  'admin-guildbot': [
    new SlashCommandSubcommandBuilder()
      .setName('announcement-channel')
      .setDescription('Set the channel for periodic announcements. Admin only.')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Channel to use for announcements')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      ),
  ],
  handle: async (interaction, client) => {
    if (
      interaction.commandName === 'admin-guildbot' &&
      interaction.options.getSubcommand() === 'announcement-channel'
    ) {

      if (!await checkAdminPermissions(interaction)) return;

      const channel = interaction.options.getChannel('channel');
      // Save the announcement channel for this guild in config_base.json
      botConfig[interaction.guild.id] = botConfig[interaction.guild.id] || {};
      botConfig[interaction.guild.id].announcementChannel = channel.id;
      saveConfig();
      await interaction.reply({ content: `Announcement channel set to <#${channel.id}>.`, flags: 64 });
    }
  },
  startPeriodicAnnouncement
};